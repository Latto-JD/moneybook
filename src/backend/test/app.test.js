import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});

test('GET /api/health -> 200 {status ok, db ok}', async () => {
  const r = await app.request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: 'ok', db: 'ok' });
});

test('보안/캐시 헤더', async () => {
  const r = await app.request('GET', '/api/health');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'same-origin');
  assert.match(r.headers['content-type'], /^application\/json; charset=utf-8$/);
});

test('없는 경로 404, 잘못된 메서드 405', async () => {
  const a = await app.request('GET', '/api/nope');
  assert.equal(a.status, 404);
  assert.equal(a.json.error.code, 'NOT_FOUND');
  const b = await app.request('POST', '/api/health');
  assert.equal(b.status, 405);
  assert.equal(b.json.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal(b.headers.allow, 'GET');
});

test('CSRF: Origin 없음/불일치는 403, 일치하면 통과', async () => {
  const body = { email: 'a@ex.com', password: 'x' };
  const none = await app.request('POST', '/api/auth/login', { body, origin: null });
  assert.equal(none.status, 403);
  assert.equal(none.json.error.code, 'CSRF_REJECTED');
  const evil = await app.request('POST', '/api/auth/login', { body, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const nullOrigin = await app.request('POST', '/api/auth/logout', { origin: 'null' });
  assert.equal(nullOrigin.status, 403);
  const ok = await app.request('POST', '/api/auth/logout');
  assert.equal(ok.status, 204);
  for (const m of ['PUT', 'DELETE']) {
    // 라우트가 없어도(404) 다음 차수에서 같은 검사가 적용되도록 Origin 검사는 라우트 매칭 이후에 수행된다
    const r = await app.request(m, '/api/auth/me', { origin: null });
    assert.equal(r.status, 405);
  }
});

test('CSRF: x-forwarded-host 와 같은 Origin 허용', async () => {
  const r = await app.request('POST', '/api/auth/logout', {
    origin: 'https://moneybook.vercel.app',
    headers: { 'x-forwarded-host': 'moneybook.vercel.app' },
  });
  assert.equal(r.status, 204);
});

test('Content-Type: text/plain, form 은 415', async () => {
  const t = await app.request('POST', '/api/auth/login', { raw: '{"a":1}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(t.status, 415);
  assert.equal(t.json.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  const f = await app.request('POST', '/api/auth/login', {
    raw: 'email=a&password=b',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(f.status, 415);
  const ok = await app.request('POST', '/api/auth/login', {
    raw: '{"email":"a@ex.com","password":"x"}',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  assert.equal(ok.status, 401);
});

test('잘못된 JSON 400 INVALID_JSON, 배열 본문도 400', async () => {
  const a = await app.request('POST', '/api/auth/login', { raw: '{bad' });
  assert.equal(a.status, 400);
  assert.equal(a.json.error.code, 'INVALID_JSON');
  const b = await app.request('POST', '/api/auth/login', { raw: '[1]' });
  assert.equal(b.status, 400);
  assert.equal(b.json.error.code, 'INVALID_JSON');
});

test('본문 16KB 초과 413, 정확히 16KB 이하는 통과', async () => {
  const big = JSON.stringify({ email: 'a@ex.com', password: 'x'.repeat(17 * 1024) });
  const r = await app.request('POST', '/api/auth/login', { raw: big });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, 'PAYLOAD_TOO_LARGE');
  const small = JSON.stringify({ email: 'a@ex.com', password: 'x'.repeat(8 * 1024) });
  const s = await app.request('POST', '/api/auth/login', { raw: small });
  assert.equal(s.status, 401);
});

test('인증 필요 API 는 세션 없으면 401, 쓰레기 쿠키도 401', async () => {
  const a = await app.request('GET', '/api/auth/me');
  assert.equal(a.status, 401);
  assert.equal(a.json.error.code, 'UNAUTHENTICATED');
  const b = await app.request('GET', '/api/auth/me', { cookie: 'mb_sid=' + 'A'.repeat(43) });
  assert.equal(b.status, 401);
  const c = await app.request('GET', '/api/auth/me', { cookie: "mb_sid=' or 1=1 --" });
  assert.equal(c.status, 401);
});

test('내부 오류는 500 INTERNAL_ERROR 이고 스택/SQL 이 없다', async () => {
  const broken = await startApp();
  await broken.db.exec('drop table sessions cascade');
  try {
    const r = await broken.request('GET', '/api/auth/me', { cookie: 'mb_sid=' + 'A'.repeat(43) });
    assert.equal(r.status, 500);
    assert.equal(r.json.error.code, 'INTERNAL_ERROR');
    assert.ok(!/sessions|select|at /i.test(r.text.replace('INTERNAL_ERROR', '')));
  } finally {
    await broken.close();
  }
});
