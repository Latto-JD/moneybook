// 월 예산 순수 함수 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBudgetInput, BUDGET_RANGE_TEXT, categoryMeta, budgetInputDisplay, budgetButtonLabel, budgetSavedText, remainText, budgetItems, buildBudgetCard, budgetDraft,
} from '../public/js/lib/budget-data.js';

test('입력 해석: 빈 칸은 지우기, 범위 밖·숫자 아님은 문구', () => {
  assert.deepEqual(parseBudgetInput(''), { ok: true, value: null });
  assert.deepEqual(parseBudgetInput('  '), { ok: true, value: null });
  assert.deepEqual(parseBudgetInput('400,000'), { ok: true, value: 400000 });
  assert.equal(parseBudgetInput('1').value, 1);
  assert.equal(parseBudgetInput('100,000,000').value, 100000000);
  for (const bad of ['0', 'abc', '100,000,001', '-5', '1.5']) {
    assert.deepEqual(parseBudgetInput(bad), { ok: false, message: BUDGET_RANGE_TEXT });
  }
});

test('행 메타·버튼 이름·상태 문구', () => {
  assert.equal(categoryMeta({ budget: 400000, usedCount: 3 }), '예산 400,000원 · 기록 3건');
  assert.equal(categoryMeta({ budget: null, usedCount: 0 }), '기록 0건');
  assert.equal(budgetButtonLabel({ name: '식비', budget: null }), '식비 예산 정하기');
  assert.equal(budgetButtonLabel({ name: '식비', budget: 400000 }), '식비 예산 바꾸기, 지금 400,000원');
  assert.equal(budgetSavedText('식비', 400000), "'식비' 예산을 400,000원으로 정했어요");
  assert.equal(budgetSavedText('식비', null), "'식비' 예산을 지웠어요");
  assert.equal(budgetDraft(12000), '12,000');
  assert.equal(budgetDraft(null), '');
});

test('남음/초과: 같으면 0원 남음', () => {
  assert.equal(remainText(100, 100), '0원 남음');
  assert.equal(remainText(100, 80), '20원 남음');
  assert.equal(remainText(100, 120), '20원 초과');
});

const cats = { items: [
  { id: 'a', type: 'expense', name: '식비', active: true, sortOrder: 0, color: 1, budget: 400000 },
  { id: 'b', type: 'expense', name: '카페', active: true, sortOrder: 1, color: 2, budget: 100000 },
  { id: 'c', type: 'expense', name: '교통', active: true, sortOrder: 2, color: 3, budget: 100000 },
  { id: 'd', type: 'expense', name: '옛날', active: false, sortOrder: 3, color: 4, budget: 50000 },
  { id: 'e', type: 'expense', name: '쇼핑', active: true, sortOrder: 4, color: 5, budget: null },
  { id: 'f', type: 'income', name: '월급', active: true, sortOrder: 0, color: 6, budget: null },
] };

test('대상: 활성 지출 + 예산 있음', () => {
  assert.deepEqual(budgetItems(cats).map((i) => i.name), ['식비', '카페', '교통']);
  assert.deepEqual(budgetItems(null), []);
});

test('카드: 정렬(초과 먼저, 동률 sortOrder), 합계, 사용 안 함 제외', () => {
  const stats = { items: [
    { category: '식비', total: 320000 }, { category: '카페', total: 120000 }, { category: '옛날', total: 9999 }, { category: '쇼핑', total: 5000 },
  ] };
  const card = buildBudgetCard(cats, stats);
  assert.deepEqual(card.rows.map((r) => r.name), ['카페', '식비', '교통']);
  assert.equal(card.rows[0].over, true);
  assert.equal(card.rows[0].percent, 100);
  assert.equal(card.rows[0].remain, '20,000원 초과');
  assert.equal(card.rows[1].remain, '80,000원 남음');
  assert.equal(card.rows[1].label, '식비, 400,000원 중 320,000원 사용, 80,000원 남음');
  assert.equal(card.rows[2].spent, 0);
  assert.equal(card.total.budget, 600000);
  assert.equal(card.total.spent, 440000);
  assert.equal(card.total.count, 3);
  assert.equal(card.total.text, '예산 600,000원 중 440,000원 썼어요 · 160,000원 남음');
  assert.equal(card.total.note, '예산을 정한 3개 카테고리 기준');
});

test('카드: 합계 초과 문구, 사용 = 예산은 초과 아님, 응답 없음은 0', () => {
  const one = { items: [{ type: 'expense', name: 'X', active: true, sortOrder: 0, budget: 1000 }] };
  assert.equal(buildBudgetCard(one, { items: [{ category: 'X', total: 1000 }] }).rows[0].over, false);
  assert.match(buildBudgetCard(one, { items: [{ category: 'X', total: 1500 }] }).total.text, /500원 초과$/);
  const empty = buildBudgetCard(one, null);
  assert.equal(empty.rows[0].spent, 0);
  assert.equal(buildBudgetCard({ items: [] }, null).rows.length, 0);
});

test('회귀 BG-11: 입력 중 원문을 지우지 않아 0·abc 가 빈 칸(지우기)으로 바뀌지 않는다', () => {
  for (const raw of ['0', '00', 'abc', '12a', '-5', '1.5']) {
    assert.equal(budgetInputDisplay(raw), raw);
    assert.equal(parseBudgetInput(budgetInputDisplay(raw)).ok, false, raw);
  }
  assert.equal(budgetInputDisplay('400000'), '400,000');
  assert.equal(budgetInputDisplay(''), '');
  assert.equal(parseBudgetInput(budgetInputDisplay('100000001')).ok, false);
});
