import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';
import { normalizeName } from '../auth/validate.js';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';

let app;
before(async () => {
  app = await startApp({ TRUST_PROXY: 'true' });
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from auth_attempts; delete from sessions; delete from users;');
});

const signup = (body, extra = {}) =>
  app.request('POST', '/api/auth/signup', { body: { email: 'user@example.com', password: GOOD_PASSWORD, ...body }, ...extra });
const patchMe = (body, cookie, extra = {}) => app.request('PATCH', '/api/auth/me', { body, cookie, ...extra });

test('normalizeName: 경계값과 정규화', () => {
  assert.equal(normalizeName('가').name, '가');
  assert.equal(normalizeName('가'.repeat(20)).name, '가'.repeat(20));
  assert.ok(normalizeName('가'.repeat(21)).error);
  assert.ok(normalizeName('').error);
  assert.ok(normalizeName('   \t\n ').error);
  assert.equal(normalizeName('  홍   길동 ').name, '홍 길동');
  assert.equal(normalizeName('홍\t길\n동').name, '홍 길 동');
  assert.ok(normalizeName('홍\u0000길동').error);
  assert.ok(normalizeName('홍\u007f길동').error);
  assert.equal(normalizeName('홍').name, '홍', 'NFC 조합형 한글을 완성형으로');
  assert.equal(normalizeName('😀'.repeat(20)).name, '😀'.repeat(20), '이모지는 코드포인트 1자');
  assert.ok(normalizeName('😀'.repeat(21)).error);
  for (const v of [undefined, null, 123, {}, []]) assert.ok(normalizeName(v).error, String(v));
});

test('가입: 정규화된 이름 저장, 응답 user 는 정확히 {id,email,name}', async () => {
  const r = await signup({ name: '  홍   길동 ' });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.json.user).sort(), ['email', 'id', 'name']);
  assert.equal(r.json.user.name, '홍 길동');
  const me = await app.request('GET', '/api/auth/me', { cookie: cookieFrom(r) });
  assert.deepEqual(me.json.user, r.json.user);
  const { rows } = await app.db.query('select name from users');
  assert.equal(rows[0].name, '홍 길동');
  assert.equal((await signup({ email: 'b@ex.com', name: '😀'.repeat(20) })).status, 201);
});

test('가입 검증: 이름 누락/null/숫자/공백/21자/제어문자는 400 + fields.name, 사용자·시도 기록 없음', async () => {
  const bad = [undefined, null, 123, '   ', '가'.repeat(21), '홍\u0001길동'];
  for (const name of bad) {
    const r = await signup({ name });
    assert.equal(r.status, 400, String(name));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.ok(r.json.error.fields.name);
  }
  assert.equal((await app.db.query('select count(*)::int n from users')).rows[0].n, 0);
  assert.equal((await app.db.query('select count(*)::int n from auth_attempts')).rows[0].n, 0);
});

test('가입 검증: 이메일과 이름이 함께 틀리면 fields 에 둘 다', async () => {
  const r = await signup({ email: 'bad', name: '' });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.fields.email);
  assert.ok(r.json.error.fields.name);
  assert.equal(r.json.error.message, r.json.error.fields.email);
});

test('로그인 응답에 name, 이름이 없는 기존 사용자는 null, 이름으로는 로그인 불가', async () => {
  await signup({ name: '홍길동' });
  const ok = await app.request('POST', '/api/auth/login', { body: { email: 'user@example.com', password: GOOD_PASSWORD } });
  assert.deepEqual(Object.keys(ok.json.user).sort(), ['email', 'id', 'name']);
  assert.equal(ok.json.user.name, '홍길동');
  assert.ok(!/password|hash/i.test(ok.text));
  assert.equal((await app.request('POST', '/api/auth/login', { body: { email: '홍길동', password: GOOD_PASSWORD } })).status, 401);

  await app.db.exec(`insert into users (email, password_hash) values ('old@ex.com', 'x')`);
  const { rows } = await app.db.query(`select id from users where email = 'old@ex.com'`);
  assert.equal(rows.length, 1);
  const { hashPassword } = await import('../auth/password.js');
  await app.db.query(`update users set password_hash = $1 where email = 'old@ex.com'`, [await hashPassword(GOOD_PASSWORD)]);
  const old = await app.request('POST', '/api/auth/login', { body: { email: 'old@ex.com', password: GOOD_PASSWORD } });
  assert.equal(old.status, 200);
  assert.equal(old.json.user.name, null);
  const me = await app.request('GET', '/api/auth/me', { cookie: cookieFrom(old) });
  assert.equal(me.json.user.name, null);
});

test('PATCH /api/auth/me: 정규화 저장, me 반영, email 불변, 다른 사용자 불변', async () => {
  const a = await signup({ name: '가' });
  const b = await signup({ email: 'b@ex.com', name: '나' });
  const r = await patchMe({ name: '  새   이름 ', email: 'hacker@ex.com' }, cookieFrom(a));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.user, { id: a.json.user.id, email: 'user@example.com', name: '새 이름' });
  const me = await app.request('GET', '/api/auth/me', { cookie: cookieFrom(a) });
  assert.deepEqual(me.json.user, r.json.user);
  const other = await app.request('GET', '/api/auth/me', { cookie: cookieFrom(b) });
  assert.equal(other.json.user.name, '나');
});

test('PATCH /api/auth/me: 400 검증(비우기 불가), 401, 403, 405', async () => {
  const a = await signup({ name: '가' });
  const cookie = cookieFrom(a);
  for (const body of [{}, { name: null }, { name: '' }, { name: '   ' }, { name: 5 }, { name: '가'.repeat(21) }, { name: '가\u0000' }]) {
    const r = await patchMe(body, cookie);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.ok(r.json.error.fields.name);
  }
  const still = await app.request('GET', '/api/auth/me', { cookie });
  assert.equal(still.json.user.name, '가');
  assert.equal((await patchMe({ name: '나' }, null)).status, 401);
  assert.equal((await patchMe({ name: '나' }, cookie, { origin: null })).status, 403);
  assert.equal((await patchMe({ name: '나' }, cookie, { origin: 'http://evil.example' })).status, 403);
  const put = await app.request('PUT', '/api/auth/me', { body: { name: '나' }, cookie });
  assert.equal(put.status, 405);
  assert.match(put.headers.allow, /GET/);
  assert.match(put.headers.allow, /PATCH/);
});

test('스키마: 마이그레이션 2회 실행 멱등, 기존 사용자 name null, name 없는 INSERT 성공, CHECK 위반', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    // 구버전 스키마(v3)로 사용자를 만든 뒤 마이그레이션한다
    await db.exec(`create table users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique check (char_length(email) between 3 and 254),
      password_hash text not null,
      created_at timestamptz not null default now())`);
    await db.exec(`insert into users (email, password_hash) values ('old@ex.com', 'x')`);
    await migrate(db);
    await migrate(db);
    const col = await db.query(
      `select is_nullable from information_schema.columns where table_name = 'users' and column_name = 'name'`,
    );
    assert.equal(col.rows.length, 1);
    assert.equal(col.rows[0].is_nullable, 'YES');
    assert.equal((await db.query(`select name from users where email = 'old@ex.com'`)).rows[0].name, null);
    await db.exec(`insert into users (email, password_hash) values ('new@ex.com', 'x')`);
    await db.exec(`insert into users (email, password_hash, name) values ('ok@ex.com', 'x', '${'가'.repeat(20)}')`);
    await assert.rejects(db.exec(`insert into users (email, password_hash, name) values ('l@ex.com', 'x', '${'가'.repeat(21)}')`));
    await assert.rejects(db.exec(`insert into users (email, password_hash, name) values ('e@ex.com', 'x', '')`));
  } finally {
    await db.close();
  }
});
