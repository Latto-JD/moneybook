// 카테고리 마이그레이션(v3) 테스트: v2 스키마+데이터 픽스처에서 새 schema.sql 적용
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';
import { DEFAULT_CATEGORIES } from '../lib/categories.js';

// v2 스키마 = schema.sql 에서 categories 이전 부분
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const V2_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf('-- 사용자별 카테고리'));

async function v2Fixture() {
  const db = await createPgliteAdapter('memory');
  await db.exec(V2_SCHEMA);
  const ids = [];
  for (const email of ['a@ex.com', 'b@ex.com', 'c@ex.com']) {
    ids.push((await db.query(`insert into users (email, password_hash) values ($1, 'x') returning id`, [email])).rows[0].id);
  }
  for (const [i, uid] of ids.entries()) {
    for (const type of ['expense', 'income']) {
      for (const [k, name] of DEFAULT_CATEGORIES[type].entries()) {
        await db.query(
          `insert into transactions (user_id, type, amount, category, date) values ($1, $2, $3, $4, '2026-10-01')`,
          [uid, type, 1000 * (k + 1) + i, name],
        );
      }
    }
  }
  return { db, ids };
}

const txStats = async (db) =>
  (await db.query('select user_id, type, category, count(*)::int n, sum(amount)::int s from transactions group by 1,2,3 order by 1,2,3')).rows;

test('C-C2 v2 데이터 마이그레이션: 사용자마다 기본 12행, 거래는 그대로', async () => {
  const { db, ids } = await v2Fixture();
  try {
    const before = await txStats(db);
    const r = await migrate(db);
    assert.equal(r.categoryUsers, 3);
    for (const uid of ids) {
      const { rows } = await db.query(
        'select type, name, active, sort_order from categories where user_id = $1 order by type desc, sort_order',
        [uid],
      );
      assert.equal(rows.length, 12);
      assert.ok(rows.every((x) => x.active === true));
      for (const type of ['expense', 'income']) {
        const of = rows.filter((x) => x.type === type);
        assert.deepEqual(of.map((x) => x.name), DEFAULT_CATEGORIES[type]);
        assert.deepEqual(of.map((x) => x.sort_order), DEFAULT_CATEGORIES[type].map((_, i) => i));
      }
    }
    assert.deepEqual(await txStats(db), before);
    const r2 = await migrate(db);
    assert.equal(r2.categoryUsers, 0);
    assert.equal((await db.query('select count(*)::int n from categories')).rows[0].n, 36);
  } finally {
    await db.close();
  }
});

test('C-C3 재실행은 사용자가 바꾼 이름·상태를 되살리지 않는다', async () => {
  const { db, ids } = await v2Fixture();
  try {
    await migrate(db);
    await db.query(`update categories set name = '밥', name_key = '밥' where user_id = $1 and name = '식비'`, [ids[0]]);
    await db.query(`update transactions set category = '밥' where user_id = $1 and category = '식비'`, [ids[0]]);
    await db.query(`update categories set active = false where user_id = $1 and name = '교통'`, [ids[0]]);
    await migrate(db);
    const { rows } = await db.query('select name, active from categories where user_id = $1 and type = $2', [ids[0], 'expense']);
    assert.equal(rows.length, 8);
    assert.ok(!rows.some((x) => x.name === '식비'));
    assert.equal(rows.find((x) => x.name === '교통').active, false);
  } finally {
    await db.close();
  }
});

test('방어용: 목록 밖 거래 카테고리는 사용 안 함 행이 된다 (15자 초과·키 중복은 건너뜀, 멱등)', async () => {
  const { db, ids } = await v2Fixture();
  try {
    const ins = (cat) =>
      db.query(`insert into transactions (user_id, type, amount, category, date) values ($1, 'expense', 100, $2, '2026-10-02')`, [ids[0], cat]);
    await ins('경조사');
    await ins('Netflix');
    await ins('NETFLIX'); // 같은 키 -> 하나만
    await ins('가'.repeat(16)); // 15자 초과 -> 건너뜀
    await ins('식비'); // 기본 세트와 같음 -> 건너뜀
    await migrate(db);
    const { rows } = await db.query(
      `select name, sort_order from categories where user_id = $1 and type = 'expense' and not active order by sort_order`,
      [ids[0]],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((x) => x.name.toLowerCase()).sort(), ['netflix', '경조사']);
    assert.ok(rows.every((x) => x.sort_order >= 8));
    const total = (await db.query('select count(*)::int n from categories')).rows[0].n;
    await migrate(db);
    assert.equal((await db.query('select count(*)::int n from categories')).rows[0].n, total);
    assert.equal((await db.query('select count(*)::int n from categories where user_id = $1 and not active', [ids[1]])).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('마이그레이션은 원자적이다: 중간에 실패하면 이전 상태로 롤백', async () => {
  const { db } = await v2Fixture();
  try {
    await assert.rejects(db.exec(`${SCHEMA}\nselect 1/0;`));
    const { rows } = await db.query(`select to_regclass('public.categories') is not null as ok`);
    assert.equal(rows[0].ok, false);
  } finally {
    await db.close();
  }
});

test('categories 제약: 이름 길이, 유형, (user, type, name_key) 유일, 사용자 삭제 시 cascade', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    const uid = (await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`)).rows[0].id;
    const ins = (type, name) =>
      db.query('insert into categories (user_id, type, name, name_key, sort_order) values ($1, $2, $3, $3, 0)', [uid, type, name]);
    await ins('expense', '가');
    await assert.rejects(ins('expense', '가'));
    await ins('income', '가'); // 다른 유형 허용
    await assert.rejects(ins('expense', ''));
    await assert.rejects(ins('expense', '가'.repeat(16)));
    await assert.rejects(ins('transfer', '나'));
    await db.query('delete from users where id = $1', [uid]);
    assert.equal((await db.query('select count(*)::int n from categories')).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
