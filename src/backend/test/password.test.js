import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { isValidEmail, isValidPassword, normalizeEmail } from '../auth/validate.js';

test('scrypt 해시 형식과 검증', async () => {
  const h1 = await hashPassword('correct horse');
  const h2 = await hashPassword('correct horse');
  assert.match(h1, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(h1, h2, '같은 비밀번호도 salt 가 달라 해시가 다르다');
  assert.ok(!h1.includes('correct horse'));
  assert.equal(await verifyPassword('correct horse', h1), true);
  assert.equal(await verifyPassword('correct horsf', h1), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.equal(await verifyPassword('x', 'scrypt$a$b$c$d$e'), false);
});

test('이메일 검증', () => {
  for (const ok of ['a@b.co', 'user.name+tag@example.com']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['a@b', 'ab.com', 'a b@c.com', 'a@@b.com', '@b.com', 'a@.com', 'a@b.', 'a@b..com', '']) {
    assert.equal(isValidEmail(bad), false, bad);
  }
  assert.equal(isValidEmail('a@' + 'b'.repeat(250) + '.com'), false);
  assert.equal(normalizeEmail('  A@Ex.COM '), 'a@ex.com');
});

test('비밀번호 길이 8~128', () => {
  assert.equal(isValidPassword('1234567'), false);
  assert.equal(isValidPassword('12345678'), true);
  assert.equal(isValidPassword('a'.repeat(128)), true);
  assert.equal(isValidPassword('a'.repeat(129)), false);
  assert.equal(isValidPassword(12345678), false);
});
