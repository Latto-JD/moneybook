import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateName } from '../public/js/lib/validate.js';
import { userLabel } from '../public/js/lib/user-label.js';
import { createApi } from '../public/js/api.js';

test('validateName 경계: 0/1/20/21자', () => {
  assert.equal(validateName('').ok, false);
  assert.equal(validateName('   ').ok, false);
  assert.deepEqual(validateName('가'), { ok: true, value: '가' });
  assert.equal(validateName('a'.repeat(20)).ok, true);
  assert.equal(validateName('a'.repeat(21)).ok, false);
});

test('validateName 정규화: 앞뒤·연속 공백, 탭·줄바꿈, NFC', () => {
  assert.equal(validateName('  홍   길동 ').value, '홍 길동');
  assert.equal(validateName('홍\t\n길동').value, '홍 길동');
  const decomposed = '홍'; // 홍 (자모 조합)
  assert.equal(validateName(decomposed).value, '홍');
});

test('validateName: 제어문자 거부, 비문자열 거부, 이모지는 코드포인트 기준', () => {
  assert.equal(validateName('홍\u0000').message, '이름에 쓸 수 없는 문자가 있어요.');
  assert.equal(validateName('홍\u007f').ok, false);
  assert.equal(validateName(null).message, '이름을 입력해 주세요.');
  assert.equal(validateName(123).ok, false);
  assert.equal(validateName('😀'.repeat(20)).ok, true);
  assert.equal(validateName('😀'.repeat(21)).ok, false);
});

test('userLabel: 이름 우선, 없으면 이메일 폴백, title 은 이메일', () => {
  assert.deepEqual(userLabel({ email: 'a@ex.com', name: '홍 길동' }), { text: '홍 길동', title: 'a@ex.com', ariaLabel: '내 정보: 홍 길동' });
  for (const name of [null, undefined, '', '  ']) {
    const l = userLabel({ email: 'a@ex.com', name });
    assert.equal(l.text, 'a@ex.com');
    assert.equal(l.title, 'a@ex.com');
    assert.match(l.ariaLabel, /이름 설정/);
  }
});

test('api.signup 은 name 을 보내고 updateMe 는 PATCH /api/auth/me', async () => {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, init });
    return { ok: true, status: 200, json: async () => ({ user: {} }), headers: { get: () => null } };
  };
  const api = createApi({ fetchImpl });
  await api.signup('a@ex.com', 'password1', '홍길동');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'a@ex.com', password: 'password1', name: '홍길동' });
  await api.updateMe('김');
  assert.equal(calls[1].path, '/api/auth/me');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].init.body), { name: '김' });
});

test('HTML: #user-name 링크(#account), 내 정보 패널, 가입 이름 필드는 기본 숨김', () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  const index = read('index.html');
  assert.match(index, /<a class="user" id="user-name" href="#account">/);
  assert.doesNotMatch(index, /user-email/);
  assert.match(index, /id="panel-account"/);
  assert.match(index, /<label for="account-name">/);
  const login = read('login.html');
  assert.match(login, /id="name-field" hidden/);
  assert.match(login, /<label for="name">/);
});
