// 카테고리 월 예산(v6) 테스트: PATCH 검증, 수입 거부, 해제, 원자성, 유지, 마이그레이션 멱등
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';

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
const find = async (u, type, name) => (await get(u)).json.items.find((i) => i.type === type && i.name === name);
const BAD = '예산은 1원 이상 1억원 이하의 정수여야 해요.';
const INCOME = '예산은 지출 카테고리에만 정할 수 있어요.';

test('BG-02 모든 카테고리 객체에 budget 키, 기본 null. POST 본문 budget 은 무시', async () => {
  const u = await newUser('a@example.com');
  const list = (await get(u)).json.items;
  assert.ok(list.every((i) => 'budget' in i && i.budget === null));
  const r = await add(u, 'expense', '새로', { budget: 5000 });
  assert.equal(r.status, 201);
  assert.equal(r.json.budget, null);
});

test('BG-03 PATCH 정하기·바꾸기·같은 값·해제, GET 반영', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  let r = await patch(u, c.id, { budget: 400000 });
  assert.equal(r.status, 200);
  assert.equal(r.json.budget, 400000);
  assert.equal((await find(u, 'expense', '식비')).budget, 400000);
  assert.equal((await patch(u, c.id, { budget: 400000 })).status, 200);
  assert.equal((await patch(u, c.id, { budget: 1 })).json.budget, 1);
  assert.equal((await patch(u, c.id, { budget: 100000000 })).json.budget, 100000000);
  r = await patch(u, c.id, { budget: null });
  assert.equal(r.status, 200);
  assert.equal(r.json.budget, null);
  assert.equal((await find(u, 'expense', '식비')).budget, null);
});

test('BG-04 잘못된 값은 400 fields.budget, 404 보다 먼저', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  for (const budget of [0, -1, 100000001, '5000', 1.5, true, [], {}]) {
    const r = await patch(u, c.id, { budget });
    assert.equal(r.status, 400, JSON.stringify(budget));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.equal(r.json.error.fields.budget, BAD);
    assert.equal(r.json.error.message, BAD);
  }
  assert.equal((await find(u, 'expense', '식비')).budget, null);
  assert.equal((await patch(u, '00000000-0000-4000-8000-000000000000', { budget: 0 })).status, 400);
});

test('BG-05 수입 카테고리: 숫자 400, null 200, 404 가 유형 검사보다 먼저', async () => {
  const u = await newUser('a@example.com');
  const b = await newUser('b@example.com');
  const inc = await find(u, 'income', '급여');
  const r = await patch(u, inc.id, { budget: 1000 });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.fields.budget, INCOME);
  const ok = await patch(u, inc.id, { budget: null });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.budget, null);
  assert.equal((await patch(b, inc.id, { budget: 1000 })).status, 404);
  assert.equal((await patch(u, 'not-a-uuid', { budget: 1000 })).status, 404);
});

test('BG-06 name+budget 한쪽이 실패하면 둘 다 반영되지 않는다', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  assert.equal((await patch(u, c.id, { name: '가'.repeat(16), budget: 5000 })).status, 400);
  assert.equal((await patch(u, c.id, { name: '교통', budget: 5000 })).status, 409); // 이름 중복
  assert.equal((await find(u, 'expense', '식비')).budget, null);
  const inc = await find(u, 'income', '급여');
  assert.equal((await patch(u, inc.id, { name: '월급', budget: 5000 })).status, 400);
  assert.equal((await find(u, 'income', '급여')).name, '급여');
  const ok = await patch(u, c.id, { name: '밥', budget: 5000 });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.name, ok.json.budget], ['밥', 5000]);
});

test('BG-06 이름 변경·사용 안 함·다시 사용·색 변경 뒤에도 budget 유지, 사용 안 함에도 정할 수 있다', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  await patch(u, c.id, { budget: 30000 });
  assert.equal((await patch(u, c.id, { name: '밥' })).json.budget, 30000);
  assert.equal((await patch(u, c.id, { active: false })).json.budget, 30000);
  assert.equal((await patch(u, c.id, { budget: 40000 })).json.budget, 40000);
  assert.equal((await patch(u, c.id, { active: true })).json.budget, 40000);
  assert.equal((await patch(u, c.id, { color: 7 })).json.budget, 40000);
});

test('BG-07 본문 없음 메시지', async () => {
  const u = await newUser('a@example.com');
  const c = await find(u, 'expense', '식비');
  const r = await patch(u, c.id, {});
  assert.equal(r.status, 400);
  assert.equal(r.json.error.message, 'name, active, color, budget 중 하나는 보내 주세요.');
});

// ---- 마이그레이션 ----
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const V4_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf('-- v5:'));
const hasCol = async (db, col) =>
  (await db.query(`select count(*)::int n from information_schema.columns where table_name='categories' and column_name=$1`, [col])).rows[0].n;

test('BG-01 색 적용 전 DB 에서 한 번에 두 열이 생기고 2번 실행해도 같다', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await db.exec(V4_SCHEMA);
    const uid = (await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`)).rows[0].id;
    await db.query(`insert into categories (user_id, type, name, name_key, sort_order) values ($1, 'expense', '식비', '식비', 0)`, [uid]);
    assert.equal(await hasCol(db, 'budget'), 0);
    await migrate(db);
    await migrate(db);
    assert.equal(await hasCol(db, 'budget'), 1);
    assert.equal(await hasCol(db, 'color'), 1);
    const s = (await db.query('select count(*)::int total, count(*) filter (where color is null)::int nulls, count(*) filter (where budget is not null)::int budgets from categories')).rows[0];
    assert.equal(s.nulls, 0);
    assert.equal(s.budgets, 0);
    await db.query(`update categories set budget = 1234 where name = '식비'`);
    await migrate(db);
    assert.equal((await db.query(`select budget from categories where name = '식비'`)).rows[0].budget, 1234);
  } finally {
    await db.close();
  }
});

test('BG-01 색만 적용된 DB(예산 열 없음)에서도 예산 열만 추가된다', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await db.exec(SCHEMA.replace(/alter table categories add column if not exists budget[\s\S]*?100000000\);\r?\n/, ''));
    assert.equal(await hasCol(db, 'budget'), 0);
    await migrate(db);
    assert.equal(await hasCol(db, 'budget'), 1);
  } finally {
    await db.close();
  }
});

test('budget check 제약: 0, 100000001 은 거부, null·1·100000000 은 허용', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    const uid = (await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`)).rows[0].id;
    const ins = (name, budget) =>
      db.query('insert into categories (user_id, type, name, name_key, sort_order, budget) values ($1, $2, $3, $3, 0, $4)', [uid, 'expense', name, budget]);
    await ins('a', null);
    await ins('b', 1);
    await ins('c', 100000000);
    await assert.rejects(ins('d', 0));
    await assert.rejects(ins('e', 100000001));
  } finally {
    await db.close();
  }
});
