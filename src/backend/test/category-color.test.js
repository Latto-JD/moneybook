// 카테고리 색(v5) 테스트: 기본 세트, POST 자동 배정, PATCH 검증, 마이그레이션 채우기·멱등
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';
import { pickColor } from '../lib/categories.js';

test('pickColor: 안 쓴 최소 번호, 다 쓰면 가장 적게 쓴 번호 중 최소, null 은 무시', () => {
  assert.equal(pickColor([]), 1);
  assert.equal(pickColor([1, 2, 3, 5]), 4);
  assert.equal(pickColor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 11);
  assert.equal(pickColor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 12);
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.equal(pickColor(all), 1);
  assert.equal(pickColor([...all, 1, 1, 2]), 3);
  assert.equal(pickColor([...all, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]), 4);
  assert.equal(pickColor([null, undefined, 0, 13, 1.5]), 1);
});

let app;
before(async () => {
  app = await startApp({}, { now: () => new Date('2026-10-18T16:00:00Z') });
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from transactions; delete from auth_attempts; delete from sessions; delete from users;');
});

async function newUser(email) {
  const r = await app.request('POST', '/api/auth/signup', { body: { email, password: GOOD_PASSWORD, name: '테스터' } });
  assert.equal(r.status, 201);
  return { cookie: cookieFrom(r), id: r.json.user.id };
}
const get = (u) => app.request('GET', '/api/categories', { cookie: u.cookie });
const add = (u, type, name, extra = {}) => app.request('POST', '/api/categories', { body: { type, name, ...extra }, cookie: u.cookie });
const patch = (u, id, body) => app.request('PATCH', `/api/categories/${id}`, { body, cookie: u.cookie });
const items = async (u) => (await get(u)).json.items;
const find = async (u, type, name) => (await items(u)).find((i) => i.type === type && i.name === name);
const colorsOf = async (u, type) => (await items(u)).filter((i) => i.type === type).map((i) => i.color);

test('CC-02 기본 세트 color: 지출 1..8, 수입 1..4', async () => {
  const u = await newUser('a@example.com');
  assert.deepEqual(await colorsOf(u, 'expense'), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(await colorsOf(u, 'income'), [1, 2, 3, 4]);
});

test('행이 없는 사용자의 지연 생성도 color 를 채운다', async () => {
  const u = await newUser('a@example.com');
  await app.db.query('delete from categories where user_id = $1', [u.id]);
  assert.deepEqual(await colorsOf(u, 'expense'), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('CC-03 POST 자동 배정: 9, 10, 11, 12, 그다음은 가장 적게 쓴 번호 중 최소. 본문 color 무시', async () => {
  const u = await newUser('a@example.com');
  const got = [];
  for (const [i, extra] of [{}, { color: 3 }, { color: 'x' }, {}, {}].entries()) {
    const r = await add(u, 'expense', `새${i}`, extra);
    assert.equal(r.status, 201);
    got.push(r.json.color);
  }
  assert.deepEqual(got, [9, 10, 11, 12, 1]);
  assert.equal((await add(u, 'expense', '또')).json.color, 2);
  // 수입은 따로 센다
  assert.equal((await add(u, 'income', '이자')).json.color, 5);
});

test('CC-03 비활성 카테고리의 번호도 사용 중으로 센다', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  assert.equal((await patch(u, c.id, { active: false })).status, 200);
  assert.equal((await add(u, 'expense', '새로')).json.color, 9);
});

test('CC-03 가운데 빈 번호가 있으면 그 번호를 쓴다', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '교통'); // 3번
  assert.equal((await patch(u, c.id, { color: 1 })).status, 200);
  assert.equal((await add(u, 'expense', '새로')).json.color, 3);
});

test('CC-10 color 가 null 인 행은 세지 않고 응답에 null', async () => {
  const u = await newUser('a@example.com');
  await app.db.query(`update categories set color = null where user_id = $1 and type = 'expense'`, [u.id]);
  const list = await items(u);
  assert.ok(list.filter((i) => i.type === 'expense').every((i) => i.color === null));
  assert.equal((await add(u, 'expense', '새로')).json.color, 1);
});

test('CC-04 PATCH color: 200 반영, 같은 색 중복 허용, 이름·상태 유지', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  const r = await patch(u, c.id, { color: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.json.color, 5);
  assert.equal((await find(u, 'expense', '식비')).color, 5); // 다른 카테고리(5번)와 겹쳐도 허용
  assert.equal((await patch(u, c.id, { color: 5 })).status, 200); // 같은 값도 200
  const renamed = await patch(u, c.id, { name: '밥' });
  assert.equal(renamed.json.color, 5);
  assert.equal((await patch(u, c.id, { active: false })).json.color, 5);
  assert.equal((await patch(u, c.id, { active: true })).json.color, 5);
});

test('CC-04 PATCH color 잘못된 값은 400 fields.color', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  for (const color of [0, 13, '5', 1.5, null, true, [], -1, 1e9]) {
    const r = await patch(u, c.id, { color });
    assert.equal(r.status, 400, JSON.stringify(color));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.equal(r.json.error.fields.color, '색은 1~12 중 하나여야 해요.');
  }
  assert.equal((await find(u, 'expense', '식비')).color, 1);
  // 형식 오류는 404 보다 먼저
  assert.equal((await patch(u, '00000000-0000-4000-8000-000000000000', { color: 99 })).status, 400);
});

test('CC-04 다른 사용자의 id 는 404, 색 변경 안 됨', async () => {
  const a = await newUser('a@example.com');
  const b = await newUser('b@example.com');
  const c = await find(a, 'expense', '식비');
  assert.equal((await patch(b, c.id, { color: 7 })).status, 404);
  assert.equal((await find(a, 'expense', '식비')).color, 1);
});

test('CC-04 name+color 같이 보냈다가 이름 오류가 나면 색도 바뀌지 않는다', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  const r = await patch(u, c.id, { name: '교통', color: 9 }); // 이름 중복 409
  assert.equal(r.status, 409);
  assert.equal((await find(u, 'expense', '식비')).color, 1);
  const ok = await patch(u, c.id, { name: '밥', color: 9 });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.name, ok.json.color], ['밥', 9]);
});

test('CC-05 name/active/color 아무것도 없으면 400', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  const r = await patch(u, c.id, {});
  assert.equal(r.status, 400);
});

// ---- 마이그레이션 ----
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
// v4 스키마(색 열 없음) 재현: categories 정의까지 + 기본 세트 insert 없이 직접 채운다
const V4_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf('-- v5:'));

async function v4Fixture() {
  const db = await createPgliteAdapter('memory');
  await db.exec(V4_SCHEMA);
  const uid = (await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`)).rows[0].id;
  const uid2 = (await db.query(`insert into users (email, password_hash) values ('b@ex.com', 'x') returning id`)).rows[0].id;
  return { db, uid, uid2 };
}
const seedRows = async (db, uid, type, n, startOrder = 0) => {
  for (let i = 0; i < n; i++) {
    await db.query('insert into categories (user_id, type, name, name_key, sort_order) values ($1, $2, $3, $3, $4)', [
      uid,
      type,
      `${type}${String(i).padStart(2, '0')}`,
      startOrder + i,
    ]);
  }
};

test('CC-01 마이그레이션: 열이 없던 DB 에 순서대로 채우고(10번째는 10), 재실행해도 같다', async () => {
  const { db, uid, uid2 } = await v4Fixture();
  try {
    assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name='categories' and column_name='color'`)).rows[0].n, 0);
    await seedRows(db, uid, 'expense', 14);
    await seedRows(db, uid, 'income', 4);
    await seedRows(db, uid2, 'expense', 2);
    await migrate(db);
    const colors = async (id, type) =>
      (await db.query('select color from categories where user_id = $1 and type = $2 order by sort_order', [id, type])).rows.map((r) => r.color);
    assert.deepEqual(await colors(uid, 'expense'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]);
    assert.deepEqual(await colors(uid, 'income'), [1, 2, 3, 4]);
    assert.deepEqual(await colors(uid2, 'expense'), [1, 2]);
    const stat = (await db.query('select count(*)::int total, count(*) filter (where color is null)::int nulls from categories')).rows[0];
    assert.equal(stat.nulls, 0);
    // 사용자가 바꾼 색은 재실행해도 유지, null 행만 다시 채운다
    await db.query(`update categories set color = 12 where user_id = $1 and name = 'expense00'`, [uid]);
    await db.query(`update categories set color = null where user_id = $1 and name = 'expense01'`, [uid]);
    await migrate(db);
    const after2 = await colors(uid, 'expense');
    assert.equal(after2[0], 12);
    assert.equal(after2[1], 2);
    await migrate(db);
    assert.deepEqual(await colors(uid, 'expense'), after2);
  } finally {
    await db.close();
  }
});

test('CC-01 마이그레이션: 거래는 건드리지 않고, 기본 세트를 새로 넣는 사용자도 1..8 / 1..4', async () => {
  const { db, uid } = await v4Fixture();
  try {
    await db.query(`insert into transactions (user_id, type, amount, category, date) values ($1, 'expense', 500, '식비', '2026-10-01')`, [uid]);
    await migrate(db);
    const { rows } = await db.query('select type, color from categories where user_id = $1 order by type, sort_order', [uid]);
    assert.deepEqual(rows.filter((r) => r.type === 'expense').map((r) => r.color), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(rows.filter((r) => r.type === 'income').map((r) => r.color), [1, 2, 3, 4]);
    assert.equal((await db.query('select count(*)::int n, sum(amount)::int s from transactions')).rows[0].s, 500);
  } finally {
    await db.close();
  }
});

test('color check 제약: 0, 13 은 거부, null 은 허용', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    const uid = (await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`)).rows[0].id;
    const ins = (name, color) =>
      db.query('insert into categories (user_id, type, name, name_key, sort_order, color) values ($1, $2, $3, $3, 0, $4)', [uid, 'expense', name, color]);
    await ins('a', null);
    await ins('b', 1);
    await ins('c', 12);
    await assert.rejects(ins('d', 0));
    await assert.rejects(ins('e', 13));
  } finally {
    await db.close();
  }
});
