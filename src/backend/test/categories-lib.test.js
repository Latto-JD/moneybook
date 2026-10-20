import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCategoryName, categoryOrder, DEFAULT_CATEGORIES } from '../lib/categories.js';
import { quickSuggestions } from '../rules/quick.js';
import { autocomplete } from '../rules/autocomplete.js';
import { detectOverspending } from '../rules/overspending.js';
import { errorResult, ApiError } from '../http.js';

test('normalizeCategoryName: NFC, 공백 정규화, 소문자 키, 코드포인트 길이', () => {
  assert.deepEqual(normalizeCategoryName('  반려   동물 '), { name: '반려 동물', key: '반려 동물' });
  assert.deepEqual(normalizeCategoryName(' Netflix\t구독 '), { name: 'Netflix 구독', key: 'netflix 구독' });
  // 조합형 한글(자모)은 NFC 로 합쳐진다
  assert.equal(normalizeCategoryName('한').name, '한');
  assert.equal(normalizeCategoryName('🐶'.repeat(15)).error, undefined);
  assert.ok(normalizeCategoryName('🐶'.repeat(16)).error);
  for (const bad of ['', '   ', '\t\n', 'a\u0000', '\u007f', 'a\u001fb', 1, null, undefined, {}, ['가']]) {
    assert.ok(normalizeCategoryName(bad).error, String(bad));
  }
  assert.equal(normalizeCategoryName('<b onclick=x>').name, '<b onclick=x>');
});

test('categoryOrder: 기본 세트 순서, 없으면 999', () => {
  assert.equal(categoryOrder('expense', '식비'), 0);
  assert.equal(categoryOrder('income', '기타'), 3);
  assert.equal(categoryOrder('expense', '없음'), 999);
  assert.equal(DEFAULT_CATEGORIES.expense.length + DEFAULT_CATEGORIES.income.length, 12);
});

const t = (i, category, memo, date, amount = 1000) => ({ id: `t${i}`, type: 'expense', category, memo, date, amount, createdAt: `${date}T00:00:00Z` });

test('quickSuggestions: activeNames 가 있으면 비활성·목록 밖 카테고리 그룹 제외, 없으면 기존 동작', () => {
  const today = '2026-10-19';
  const txs = [
    t(1, '식비', '점심', '2026-10-10'), t(2, '식비', '점심', '2026-10-11'), t(3, '식비', '점심', '2026-10-12'),
    t(4, '쇼핑', '점심', '2026-10-13'), t(5, '쇼핑', '점심', '2026-10-14'), t(6, '쇼핑', '점심', '2026-10-15'),
  ];
  assert.equal(quickSuggestions(txs, 'expense', today).length, 2);
  assert.deepEqual(quickSuggestions(txs, 'expense', today, new Set(['식비'])).map((x) => x.category), ['식비']);
  assert.deepEqual(quickSuggestions(txs, 'expense', today, new Set()), []);
});

test('autocomplete: activeNames 로 활성 최다 카테고리, 없으면 null', () => {
  const today = '2026-10-19';
  const txs = [
    t(1, '식비', '점심', '2026-10-10', 9000), t(2, '식비', '점심', '2026-10-11', 9000),
    t(3, '쇼핑', '점심', '2026-10-12', 8000),
  ];
  assert.equal(autocomplete(txs, '점', 'expense', today)[0].category, '식비');
  assert.equal(autocomplete(txs, '점', 'expense', today, new Set(['쇼핑']))[0].category, '쇼핑');
  const none = autocomplete(txs, '점', 'expense', today, new Set(['교통']));
  assert.deepEqual(none, [{ memo: '점심', category: null, amount: 8000 }]);
});

test('detectOverspending: orderOf 로 동률 정렬 기준을 바꾼다', () => {
  const rows = [];
  let i = 0;
  for (const category of ['쇼핑', '교통']) {
    for (const date of ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']) {
      rows.push(t(i++, category, '', date, date.startsWith('2026-10') ? 30000 : 20000));
    }
  }
  const today = '2026-10-19';
  assert.deepEqual(detectOverspending(rows, '2026-10', today).map((o) => o.category), ['교통', '쇼핑']);
  const custom = (type, c) => (c === '쇼핑' ? 0 : 1);
  assert.deepEqual(detectOverspending(rows, '2026-10', today, undefined, custom).map((o) => o.category), ['쇼핑', '교통']);
});

test('errorResult: categoryId 와 fields 를 내보낸다', () => {
  const r = errorResult(new ApiError(409, 'CATEGORY_INACTIVE', 'm', { categoryId: 'abc' }));
  assert.deepEqual(r.body, { error: { code: 'CATEGORY_INACTIVE', message: 'm', categoryId: 'abc' } });
  const v = errorResult(new ApiError(400, 'VALIDATION_ERROR', 'm', { fields: { name: 'x' } }));
  assert.deepEqual(v.body.error.fields, { name: 'x' });
  assert.equal('categoryId' in v.body.error, false);
});
