import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHostHeader, isLoopbackRemote } from '../scripts/dev-server.js';

test('/__qa Host 검사: 로컬 Host 는 통과', () => {
  for (const h of ['localhost', 'localhost:3000', 'LOCALHOST:3000', '127.0.0.1:3000', '127.0.0.1', '[::1]', '[::1]:3000']) {
    assert.equal(isLocalHostHeader(h), true, h);
  }
});

test('/__qa Host 검사: 외부/bare ::1/빈 값은 거부', () => {
  for (const h of ['evil.example.com', 'evil.example.com:3000', 'localhost.evil.com', '::1', '', undefined, null]) {
    assert.equal(isLocalHostHeader(h), false, String(h));
  }
});

test('/__qa 원격 주소 검사: 루프백(IPv4-mapped 포함)만 통과', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackRemote(a), true, a);
  for (const a of ['10.0.0.5', '192.168.0.2', '::ffff:10.0.0.5', '', undefined]) assert.equal(isLoopbackRemote(a), false, String(a));
});
