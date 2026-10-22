import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewedMonthName, balanceLabel, summaryLabel } from '../public/js/lib/dashboard-data.js';

test('균형 카드 라벨: 이번 달 / M월 / YYYY년 M월', () => {
  assert.equal(balanceLabel('2026-10', '2026-10'), '이번 달 남은 돈');
  assert.equal(balanceLabel('2026-09', '2026-10'), '9월 남은 돈');
  assert.equal(balanceLabel('2026-12', '2026-10'), '12월 남은 돈');
  assert.equal(balanceLabel('2025-12', '2026-10'), '2025년 12월 남은 돈');
  assert.equal(summaryLabel('2026-10', '2026-10'), '이번 달 요약');
  assert.equal(summaryLabel('2026-09', '2026-10'), '9월 요약');
  assert.equal(summaryLabel('2025-12', '2026-10'), '2025년 12월 요약');
  assert.equal(viewedMonthName('2026-01', '2026-01'), '이번 달');
});

test('미사용 CSS 3개는 style.css 에 없다', () => {
  const css = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
  for (const sel of ['.dash-tools', '.balance-note', '.chart-text-strong']) assert.ok(!css.includes(sel), sel);
});

import { validateName } from '../public/js/lib/validate.js';
import { validateCategoryName, normalizeCategoryName } from '../public/js/lib/categories-data.js';
import { isReservedCategoryName, RESERVED_NAME_ERROR } from '../public/js/lib/text.js';

const FORBIDDEN = ['\u202e', '\u2066', '\u2069', '\u200e', '\u200f', '\u202a'];
const ZERO_WIDTH = ['\u200b', '\u2060', '\ufeff'];

test('이름: 방향 제어 문자는 거부, 폭 없는 문자는 제거, ZWJ 이모지는 통과', () => {
  for (const ch of FORBIDDEN) {
    assert.equal(validateName(`홍${ch}길동`).message, '이름에 쓸 수 없는 문자가 있어요.', ch.codePointAt(0).toString(16));
  }
  for (const ch of ZERO_WIDTH) {
    assert.equal(validateName(`홍${ch}길동`).value, '홍길동');
    assert.equal(validateName(ch).message, '이름은 1자 이상 20자 이하여야 해요.');
    assert.equal(validateName(` ${ch} `).ok, false);
  }
  const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
  assert.equal(validateName(family).value, family);
  assert.equal(validateName('\u200c').ok, true); // ZWNJ 는 유지
  assert.equal(validateName('홍\u0000').ok, false);
  assert.equal(validateName('  홍\t\n  길동 ').value, '홍 길동');
});

test('카테고리 이름: 같은 공통 규칙', () => {
  for (const ch of FORBIDDEN) assert.equal(validateCategoryName(`식${ch}비`).ok, false);
  assert.equal(validateCategoryName('식\u200b비').value, '식비');
  assert.equal(validateCategoryName('\ufeff').ok, false);
  assert.equal(normalizeCategoryName(' 식  비 '), '식 비');
  assert.equal(validateCategoryName('가'.repeat(16)).ok, false);
  assert.equal(validateCategoryName('가'.repeat(15)).ok, true);
});

test('"그 외 N개" 금지: 정규화 후 같은 모양은 거부, 비슷한 이름은 허용', () => {
  assert.equal(validateCategoryName('그 외 2개').message, RESERVED_NAME_ERROR);
  assert.equal(validateCategoryName(' 그 외  12개 ').message, RESERVED_NAME_ERROR);
  assert.equal(validateCategoryName('그\u200b 외 3개').ok, false);
  for (const ok of ['그 외', '그 외 것', '그외 2개', '그 외 2개월', '그 외 이개']) assert.equal(validateCategoryName(ok).ok, true, ok);
  assert.equal(isReservedCategoryName('그 외 ٣개'), false); // ASCII 숫자만
});

test('"그 외 N개" 이름 바꾸기: 지금 이름과 같으면 막지 않음', () => {
  assert.equal(validateCategoryName('그 외 2개', '그 외 2개').ok, true);
  assert.equal(validateCategoryName('그 외 3개', '그 외 2개').ok, false);
});
