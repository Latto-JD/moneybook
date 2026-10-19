import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody, ApiError } from '../http.js';
import { readConfig } from '../config.js';
import { clientIp } from '../security.js';
import { dummyVerify } from '../auth/password.js';

// Vercel 처럼 스트림이 이미 소비되고 req.body 가 채워진 요청 흉내
function consumed(body, headers = {}) {
  const req = Readable.from([]);
  req.headers = { 'content-type': 'application/json', 'content-length': '10', ...headers };
  req.body = body;
  return req.resume() && new Promise((r) => req.on('end', () => r(req)));
}

test('Vercel 폴백: req.body 가 객체/문자열/Buffer 여도 파싱된다', async () => {
  assert.deepEqual(await readJsonBody(await consumed({ a: 1 })), { a: 1 });
  assert.deepEqual(await readJsonBody(await consumed('{"b":2}')), { b: 2 });
  assert.deepEqual(await readJsonBody(await consumed(Buffer.from('{"c":3}'))), { c: 3 });
});

test('Vercel 폴백: 잘못된 JSON 문자열/Buffer 는 400 INVALID_JSON', async () => {
  for (const b of ['{oops', Buffer.from('not json')]) {
    await assert.rejects(readJsonBody(await consumed(b)), (e) => e instanceof ApiError && e.status === 400 && e.code === 'INVALID_JSON');
  }
});

test('Vercel 폴백: 배열/원시값 body 는 400, 너무 큰 body 는 413', async () => {
  await assert.rejects(readJsonBody(await consumed([1])), (e) => e.status === 400);
  await assert.rejects(readJsonBody(await consumed('"x"')), (e) => e.status === 400);
  await assert.rejects(readJsonBody(await consumed({ big: 'x'.repeat(20000) })), (e) => e.status === 413);
});

test('trustProxy: VERCEL=1 또는 TRUST_PROXY=true 에서만 켜지고 x-forwarded-for 첫 값을 쓴다', () => {
  assert.equal(readConfig({}).trustProxy, false);
  assert.equal(readConfig({ VERCEL: '1' }).trustProxy, true);
  assert.equal(readConfig({ VERCEL: '0' }).trustProxy, false);
  assert.equal(readConfig({ TRUST_PROXY: 'true' }).trustProxy, true);
  const req = { headers: { 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, readConfig({ VERCEL: '1' })), '1.2.3.4');
  assert.equal(clientIp(req, readConfig({})), '10.0.0.1');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:9.9.9.9' } }, readConfig({ VERCEL: '1' })), '9.9.9.9');
});

test('dummyVerify 는 항상 false', async () => {
  assert.equal(await dummyVerify('x'), false);
});
