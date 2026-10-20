// 카테고리 관리용 순수 함수 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeCategoryName, validateCategoryName, activeNamesOf, splitItems, renameNote, disableConfirmText,
  inactiveChipLabel, MAX_NAME_LENGTH,
} from '../public/js/lib/categories-data.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('이름 정규화/검증: 서버 규칙과 같다 (NFC, 공백 정리, 1~15 코드포인트, 제어문자 거부)', () => {
  assert.equal(normalizeCategoryName('  반려   동물 '), '반려 동물');
  assert.equal(normalizeCategoryName('a\t\nb'), 'a b');
  assert.equal(normalizeCategoryName('한'), '한'); // NFC
  assert.equal(validateCategoryName('  이자 ').value, '이자');
  assert.equal(validateCategoryName('').ok, false);
  assert.equal(validateCategoryName('   ').ok, false);
  assert.equal(validateCategoryName(undefined).ok, false);
  assert.equal(validateCategoryName('가'.repeat(MAX_NAME_LENGTH)).ok, true);
  assert.equal(validateCategoryName('가'.repeat(MAX_NAME_LENGTH + 1)).ok, false);
  assert.equal(validateCategoryName('😀'.repeat(15)).ok, true); // 코드포인트 기준
  assert.equal(validateCategoryName('😀'.repeat(16)).ok, false);
  assert.equal(validateCategoryName('a\u0000b').ok, false);
  assert.equal(validateCategoryName('<b onclick=x>').ok, true); // 꺾쇠는 허용 (출력은 textContent)
});

const RESP = {
  expense: ['식비', '반려동물'],
  income: ['급여'],
  items: [
    { id: '1', type: 'expense', name: '식비', active: true, sortOrder: 0, usedCount: 21 },
    { id: '2', type: 'expense', name: '경조사', active: false, sortOrder: 1, usedCount: 4 },
    { id: '3', type: 'expense', name: '반려동물', active: true, sortOrder: 2, usedCount: 0 },
    { id: '4', type: 'income', name: '급여', active: true, sortOrder: 0, usedCount: 6 },
  ],
};

test('활성 이름 / 유형별 분리: 지출과 수입이 같은 방식으로 나뉜다', () => {
  assert.deepEqual(activeNamesOf(RESP), { expense: ['식비', '반려동물'], income: ['급여'] });
  assert.deepEqual(activeNamesOf(null), { expense: [], income: [] });
  assert.deepEqual(activeNamesOf({ expense: 'x', income: [1, '급여'] }), { expense: [], income: ['급여'] });
  const e = splitItems(RESP, 'expense');
  assert.deepEqual(e.active.map((i) => i.name), ['식비', '반려동물']);
  assert.deepEqual(e.inactive.map((i) => i.name), ['경조사']);
  const i = splitItems(RESP, 'income');
  assert.deepEqual([i.active.length, i.inactive.length], [1, 0]);
  assert.deepEqual(splitItems(null, 'expense'), { active: [], inactive: [] });
});

test('안내 문구', () => {
  assert.equal(renameNote(21), '지난 기록 21건도 새 이름으로 바뀌어요.');
  assert.doesNotMatch(renameNote(0), /0건/);
  assert.equal(
    disableConfirmText('경조사', 4),
    "'경조사' 카테고리를 사용 안 함으로 바꿀까요? 지금까지의 기록 4건과 통계는 그대로 남고, 새 기록에서만 고를 수 없어요.",
  );
  assert.equal(inactiveChipLabel('경조사'), '경조사 (사용 안 함)');
});

test('정적 HTML: 관리 패널/보기 전환 id 존재, 하단 탭은 2개, 관리 입력에 label, 토글 구조 동일', () => {
  const html = read('../public/index.html');
  for (const id of ['panel-categories', 'cat-title', 'catm-expense', 'catm-income', 'catm-add', 'catm-name', 'catm-active', 'catm-inactive',
    'catview-expense', 'catview-income', 'catm-status']) assert.match(html, new RegExp(`id="${id}"`), id);
  const nav = html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
  assert.equal((nav.match(/<a /g) || []).length, 2);
  assert.match(html, /<label[^>]*for="catm-name"/);
  assert.match(html, /id="catm-expense"[^>]*>지출<\/button>\s*<button[^>]*id="catm-income"[^>]*>수입/);
  assert.match(html, /id="catview-expense"[^>]*>지출<\/button>\s*<button[^>]*id="catview-income"[^>]*>수입/);
});

test('CSS: --ok 는 없고 --danger 는 오류 문구/삭제 버튼에만 (수입·지출 가치 중립)', () => {
  const css = read('../public/css/style.css');
  assert.doesNotMatch(css, /--ok/);
  const uses = css.split('\n').filter((l) => l.includes('var(--danger)'));
  assert.ok(uses.length >= 2);
  for (const l of uses) assert.match(l, /^\.(error-text|btn-danger)\b/, l);
});
