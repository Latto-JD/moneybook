import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDevServer, isLocalHostHeader, isLoopbackRemote } from '../scripts/dev-server.js';

test('정적 파일: .woff2 는 font/woff2 로 서빙', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dev-server-'));
  await writeFile(path.join(root, 'a.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  const server = createDevServer({ handler: () => {}, root, env: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/a.woff2`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
    assert.equal((await res.arrayBuffer()).byteLength, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

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
