// 이름류 공통 검증(lib/text.js) 경계표 + 사용자 이름·카테고리 이름 적용 + "그 외 N개" 금지
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanText, isReservedCategoryName } from '../lib/text.js';
import { normalizeCategoryName } from '../lib/categories.js';
import { normalizeName } from '../auth/validate.js';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';

const FORBIDDEN = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069', '\u200e', '\u200f', '\u0001', '\u007f'];
const STRIPPED = ['\u200b', '\u2060', '\ufeff'];

test('cleanText: 방향 제어·제어 문자는 거부', () => {
  for (const ch of FORBIDDEN) {
    assert.equal(cleanText(`가${ch}나`).forbidden, true, `U+${ch.codePointAt(0).toString(16)}`);
  }
});

test('cleanText: 폭 없는 문자 제거, 그것만이면 빈 문자열', () => {
  for (const ch of STRIPPED) {
    assert.equal(cleanText(`가${ch}나`).text, '가나');
    assert.equal(cleanText(` ${ch}${ch} `).text, '');
  }
  assert.equal(cleanText('가\u200b 나').text, '가 나');
  assert.equal(cleanText(' \u200b가\ufeff ').text, '가', '제거 후 공백 정리');
});

test('cleanText: ZWJ/ZWNJ 이모지 조합 유지, NFC, 공백 정리', () => {
  const family = '👨\u200d👩\u200d👧';
  assert.equal(cleanText(family).text, family);
  assert.equal([...cleanText(family).text].length, 5, '코드포인트 길이 기준');
  assert.equal(cleanText('\u200c').text, '\u200c');
  assert.equal(cleanText('홍').text, '홍');
  assert.equal(cleanText(' 홍 \t\n  길동 ').text, '홍 길동');
});

test('normalizeName / normalizeCategoryName: 같은 경계표', () => {
  for (const norm of [normalizeName, normalizeCategoryName]) {
    for (const ch of FORBIDDEN) assert.ok(norm(`가${ch}`).error, `U+${ch.codePointAt(0).toString(16)}`);
    for (const ch of STRIPPED) {
      assert.equal(norm(`가${ch}나`).name, '가나');
      assert.ok(norm(ch).error, '그것만으로 된 이름은 1자 이상 오류');
      assert.ok(norm(` ${ch} `).error);
    }
    assert.equal(norm('👨\u200d👩\u200d👧').error, undefined);
  }
  assert.equal(normalizeCategoryName('Ab\u200bC').key, 'abc');
  // 길이는 제거 후 기준: 한도만큼 + 폭 없는 문자는 통과
  assert.equal(normalizeName('가'.repeat(20) + '\u200b').error, undefined);
  assert.ok(normalizeName('가'.repeat(21) + '\u200b').error);
  assert.equal(normalizeCategoryName('가'.repeat(15) + '\ufeff').error, undefined);
});

test('isReservedCategoryName: "그 외 N개" 모양만', () => {
  for (const n of ['그 외 2개', '그 외 12개', '그 외 0개']) assert.equal(isReservedCategoryName(n), true, n);
  for (const n of ['그 외', '그 외 것', '그외 2개', '그 외 2', '그 외 개', '그 외 2개 더', '기타 그 외 2개', '그 외 -1개']) {
    assert.equal(isReservedCategoryName(n), false, n);
  }
  // 정규화 후 같은 형태
  assert.equal(isReservedCategoryName(normalizeCategoryName(' 그  외\t12개 ').name), true);
});

test('프론트 text.js 가 있으면 서버와 같은 정규식을 쓴다', async () => {
  const front = new URL('../../frontend/public/js/lib/text.js', import.meta.url);
  let src;
  try {
    src = await readFile(front, 'utf8');
  } catch {
    return; // 아직 없음 (프론트 담당)
  }
  const server = await readFile(new URL('../lib/text.js', import.meta.url), 'utf8');
  for (const re of server.match(/\/\[[^\]]+\]\/g?/g)) assert.ok(src.includes(re), `프론트에 ${re} 없음`);
});

let app;
before(async () => {
  app = await startApp({ TRUST_PROXY: 'true' });
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from transactions; delete from auth_attempts; delete from sessions; delete from users;');
});

async function newUser(email = 'a@ex.com', name = '테스터') {
  const r = await app.request('POST', '/api/auth/signup', { body: { email, password: GOOD_PASSWORD, name } });
  return { r, cookie: cookieFrom(r) };
}
const addCat = (u, name, type = 'expense') => app.request('POST', '/api/categories', { body: { type, name }, cookie: u.cookie });
const patchCat = (u, id, body) => app.request('PATCH', `/api/categories/${id}`, { body, cookie: u.cookie });

test('가입·PATCH me: 방향 문자 400, 폭 없는 문자 제거 저장, 그것만이면 400, ZWJ 이모지 통과', async () => {
  assert.equal((await newUser('a@ex.com', '홍\u202e길동')).r.status, 400);
  assert.equal((await newUser('b@ex.com', '\u200b\ufeff')).r.status, 400);
  const u = await newUser('c@ex.com', '홍\u200b길동');
  assert.equal(u.r.status, 201);
  assert.equal(u.r.json.user.name, '홍길동');
  const fam = '👨\u200d👩\u200d👧';
  const p = await app.request('PATCH', '/api/auth/me', { body: { name: fam }, cookie: u.cookie });
  assert.equal(p.status, 200);
  assert.equal(p.json.user.name, fam);
  const bad = await app.request('PATCH', '/api/auth/me', { body: { name: '\u2066' }, cookie: u.cookie });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.fields.name);
  const zw = await app.request('PATCH', '/api/auth/me', { body: { name: '\u2060' }, cookie: u.cookie });
  assert.equal(zw.status, 400);
});

test('카테고리 추가·이름 변경: 방향 문자 400, 폭 없는 문자 제거 저장', async () => {
  const u = await newUser();
  assert.equal((await addCat(u, '반\u202e려')).status, 400);
  assert.equal((await addCat(u, '\u200b')).status, 400);
  const ok = await addCat(u, '반\u200b려');
  assert.equal(ok.status, 201);
  assert.equal(ok.json.name, '반려');
  assert.equal((await addCat(u, '반려')).json.error.code, 'CATEGORY_EXISTS', '제거 후 같은 이름이면 중복');
  assert.equal((await patchCat(u, ok.json.id, { name: '펫\u200f' })).status, 400);
  const ren = await patchCat(u, ok.json.id, { name: '펫\u2060' });
  assert.equal(ren.status, 200);
  assert.equal(ren.json.name, '펫');
});

test('카테고리: "그 외 N개" 추가·이름 변경 400, 비슷한 이름은 허용', async () => {
  const u = await newUser();
  for (const name of ['그 외 2개', ' 그 외  12개 ']) {
    const r = await addCat(u, name);
    assert.equal(r.status, 400, name);
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.match(r.json.error.fields.name, /그 외 N개/);
  }
  for (const name of ['그 외', '그 외 것', '그외 2개']) assert.equal((await addCat(u, name)).status, 201, name);
  const c = await addCat(u, '임시');
  const r = await patchCat(u, c.json.id, { name: '그 외 3개' });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.fields.name);
  assert.equal((await addCat(u, '그 외 2개', 'income')).status, 400, '수입에도 적용');
});

test('카테고리: 이미 저장된 "그 외 N개" 이름은 그대로 유지 가능', async () => {
  const u = await newUser();
  const c = await addCat(u, '임시');
  const { rows } = await app.db.query(`select id from categories where name = '임시'`);
  await app.db.query(`update categories set name = '그 외 2개', name_key = '그 외 2개' where id = $1`, [rows[0].id]);
  const same = await patchCat(u, c.json.id, { name: '그 외 2개', active: false });
  assert.equal(same.status, 200);
  assert.equal(same.json.active, false);
  assert.equal((await patchCat(u, c.json.id, { name: '그 외 3개' })).status, 400, '다른 "그 외 N개" 로는 못 바꿈');
  assert.equal((await patchCat(u, c.json.id, { name: '정상' })).status, 200);
});
