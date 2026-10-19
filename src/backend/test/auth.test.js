import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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

const signup = (email = 'user@example.com', password = GOOD_PASSWORD, extra = {}) =>
  app.request('POST', '/api/auth/signup', { body: { email, password }, ...extra });
const login = (email = 'user@example.com', password = GOOD_PASSWORD, extra = {}) =>
  app.request('POST', '/api/auth/login', { body: { email, password }, ...extra });

test('가입 성공: 201, user, 쿠키 속성, 비밀 값 미노출', async () => {
  const r = await signup('User@Example.com');
  assert.equal(r.status, 201);
  assert.equal(r.json.user.email, 'user@example.com');
  assert.match(r.json.user.id, /^[0-9a-f-]{36}$/);
  assert.ok(!/password|hash/i.test(r.text));
  const sc = r.headers['set-cookie'][0];
  assert.match(sc, /^mb_sid=[A-Za-z0-9_-]{43};/);
  for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(sc.includes(attr), attr);
  assert.ok(!sc.includes('Secure'), 'COOKIE_SECURE=false 이면 Secure 없음');
  const me = await app.request('GET', '/api/auth/me', { cookie: cookieFrom(r) });
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.user, r.json.user);
});

test('COOKIE_SECURE 기본값은 Secure 포함', async () => {
  const secure = await startApp({ COOKIE_SECURE: undefined });
  try {
    const r = await secure.request('POST', '/api/auth/signup', { body: { email: 'a@ex.com', password: GOOD_PASSWORD } });
    assert.match(r.headers['set-cookie'][0], /; Secure; SameSite=Lax/);
  } finally {
    await secure.close();
  }
});

test('가입 검증: 이메일/비밀번호 400, 경계값', async () => {
  for (const email of ['a@b', 'ab.com', 'a b@ex.com']) {
    const r = await signup(email);
    assert.equal(r.status, 400, email);
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.ok(r.json.error.fields.email);
  }
  assert.equal((await signup('a@ex.com', '1234567')).status, 400);
  assert.equal((await signup('a@ex.com', 'x'.repeat(129))).status, 400);
  assert.equal((await signup('a@ex.com', 12345678)).status, 400);
  assert.equal((await signup('b@ex.com', '12345678')).status, 201);
  assert.equal((await signup('c@ex.com', 'x'.repeat(128))).status, 201);
});

test('이메일 중복은 대소문자 무시 409', async () => {
  assert.equal((await signup('A@Ex.com')).status, 201);
  const r = await signup('a@ex.com');
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'EMAIL_TAKEN');
});

test('SIGNUP_ENABLED=false 면 가입 403', async () => {
  const closed = await startApp({ SIGNUP_ENABLED: 'false' });
  try {
    const r = await closed.request('POST', '/api/auth/signup', { body: { email: 'a@ex.com', password: GOOD_PASSWORD } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'SIGNUP_DISABLED');
  } finally {
    await closed.close();
  }
});

test('DB 에는 scrypt 해시와 토큰 해시만 저장된다', async () => {
  const a = await signup('a@ex.com', GOOD_PASSWORD);
  await signup('b@ex.com', GOOD_PASSWORD);
  const { rows } = await app.db.query('select password_hash from users order by email');
  assert.ok(rows.every((r) => r.password_hash.startsWith('scrypt$') && !r.password_hash.includes(GOOD_PASSWORD)));
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  const token = cookieFrom(a).split('=')[1];
  const s = await app.db.query('select token_hash from sessions');
  assert.ok(s.rows.length >= 1);
  assert.ok(s.rows.every((r) => r.token_hash !== token && /^[0-9a-f]{64}$/.test(r.token_hash)));
});

test('로그인: 성공, 대소문자 무시, 실패는 동일한 401', async () => {
  await signup('user@example.com');
  const ok = await login('USER@example.com');
  assert.equal(ok.status, 200);
  assert.ok(cookieFrom(ok));
  const wrongPw = await login('user@example.com', 'wrong-password');
  const noUser = await login('nobody@example.com', 'wrong-password');
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.deepEqual(wrongPw.json, noUser.json);
  assert.equal(wrongPw.json.error.code, 'INVALID_CREDENTIALS');
  assert.equal((await app.request('POST', '/api/auth/login', { body: { email: 'a@ex.com' } })).status, 400);
});

test('로그아웃: 204 + Max-Age=0, 이전 쿠키는 401, 세션 없어도 204', async () => {
  const s = await signup();
  const cookie = cookieFrom(s);
  const out = await app.request('POST', '/api/auth/logout', { cookie });
  assert.equal(out.status, 204);
  assert.match(out.headers['set-cookie'][0], /^mb_sid=; Max-Age=0;/);
  const me = await app.request('GET', '/api/auth/me', { cookie });
  assert.equal(me.status, 401);
  assert.equal((await app.request('POST', '/api/auth/logout')).status, 204);
});

test('만료된 세션은 401', async () => {
  const s = await signup();
  const cookie = cookieFrom(s);
  await app.db.exec(`update sessions set expires_at = now() - interval '1 minute'`);
  assert.equal((await app.request('GET', '/api/auth/me', { cookie })).status, 401);
});

test('같은 이메일 실패 5회 후 6번째는 올바른 비밀번호여도 429 + Retry-After, 16분 뒤 해제', async () => {
  await signup();
  for (let i = 0; i < 5; i++) assert.equal((await login('user@example.com', 'bad-password')).status, 401);
  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'TOO_MANY_ATTEMPTS');
  const retry = Number(blocked.headers['retry-after']);
  assert.ok(retry > 0 && retry <= 900, `Retry-After=${retry}`);
  await app.db.exec(`update auth_attempts set created_at = now() - interval '16 minutes'`);
  assert.equal((await login()).status, 200);
});

test('실패 3회 후 성공하면 실패 카운트 초기화', async () => {
  await signup();
  for (let i = 0; i < 3; i++) await login('user@example.com', 'bad-password');
  assert.equal((await login()).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await login('user@example.com', 'bad-password')).status, 401);
  assert.equal((await login()).status, 200);
});

test('IP 로그인 실패 20회 후 21번째 429, 다른 IP 는 영향 없음', async () => {
  await signup();
  const h = (ip) => ({ headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < 20; i++) {
    const r = await login(`u${i}@ex.com`, 'bad-password', h('9.9.9.9'));
    assert.equal(r.status, 401);
  }
  assert.equal((await login('u99@ex.com', 'bad-password', h('9.9.9.9'))).status, 429);
  assert.equal((await login('user@example.com', GOOD_PASSWORD, h('8.8.8.8'))).status, 200);
});

test('IP 가입 10회/시간 후 11번째 429', async () => {
  const h = { headers: { 'x-forwarded-for': '7.7.7.7' } };
  for (let i = 0; i < 10; i++) {
    const r = await signup(`s${i}@ex.com`, GOOD_PASSWORD, h);
    assert.equal(r.status, 201);
  }
  const r = await signup('s10@ex.com', GOOD_PASSWORD, h);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
  assert.equal((await signup('other@ex.com', GOOD_PASSWORD, { headers: { 'x-forwarded-for': '6.6.6.6' } })).status, 201);
});

test('TRUST_PROXY 미설정이면 x-forwarded-for 를 무시한다', async () => {
  const strict = await startApp();
  try {
    for (let i = 0; i < 20; i++) {
      await strict.request('POST', '/api/auth/login', {
        body: { email: `u${i}@ex.com`, password: 'bad-password' },
        headers: { 'x-forwarded-for': `1.1.1.${i}` },
      });
    }
    const r = await strict.request('POST', '/api/auth/login', {
      body: { email: 'z@ex.com', password: 'bad-password' },
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });
    assert.equal(r.status, 429, '헤더를 바꿔도 소켓 IP 기준으로 제한된다');
  } finally {
    await strict.close();
  }
});

test('가입/로그인/로그아웃도 Origin 없으면 403', async () => {
  const body = { email: 'a@ex.com', password: GOOD_PASSWORD };
  assert.equal((await app.request('POST', '/api/auth/signup', { body, origin: null })).status, 403);
  assert.equal((await app.request('POST', '/api/auth/login', { body, origin: null })).status, 403);
  assert.equal((await app.request('POST', '/api/auth/logout', { origin: null })).status, 403);
});

test('병렬 로그인 10건(틀린 비밀번호)은 401이 5건 이하, 나머지 429 (B1; 실제 PG는 직렬화 순서가 달라 정확한 개수 대신 한도 초과 불가를 보장)', async () => {
  await signup();
  const rs = await Promise.all(Array.from({ length: 10 }, () => login('user@example.com', 'bad-password')));
  const s401 = rs.filter((r) => r.status === 401).length;
  const s429 = rs.filter((r) => r.status === 429).length;
  assert.ok(s401 <= 5, `401 은 5건 이하여야 함: ${s401}`);
  assert.equal(s401 + s429, 10, '모든 응답은 401 또는 429');
  assert.equal((await login()).status, 429, '차단 후에는 올바른 비밀번호도 429');
  assert.equal((await login('user@example.com', 'bad-password')).status, 429, '차단 후에는 틀린 비밀번호도 429');
});

test('병렬 로그인 후 한도 안이면 정상 로그인 성공 및 실패 기록 초기화', async () => {
  await signup();
  await Promise.all(Array.from({ length: 3 }, () => login('user@example.com', 'bad-password')));
  assert.equal((await login()).status, 200);
  const { rows } = await app.db.query(`select count(*)::int n from auth_attempts where kind='login' and success=false`);
  assert.equal(rows[0].n, 0);
});

test('병렬 가입 12건은 201이 10건 이하, 나머지 429 (실제 PG는 직렬화 순서가 달라 한도 초과 불가만 보장)', async () => {
  const rs = await Promise.all(
    Array.from({ length: 12 }, (_, i) => signup(`p${i}@ex.com`, GOOD_PASSWORD, { headers: { 'x-forwarded-for': '7.7.7.7' } })),
  );
  const s201 = rs.filter((r) => r.status === 201).length;
  const s429 = rs.filter((r) => r.status === 429).length;
  assert.ok(s201 <= 10, `201 은 10건 이하여야 함: ${s201}`);
  assert.equal(s201 + s429, 12, '모든 응답은 201 또는 429');
  assert.ok(s429 >= 2, '한도(10건)를 넘는 최소 2건은 429');
});
