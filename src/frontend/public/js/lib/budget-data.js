// 월 예산 순수 함수. 필드와 규칙은 docs/api.md 3A(budget), 계획은 docs/plan-budget.md.
import { parseAmount, formatWon, formatNumber, formatAmountInput } from './money.js';

export const BUDGET_RANGE_TEXT = '예산은 1원 이상 1억원 이하의 숫자로 입력해 주세요';

/**
 * 예산 입력칸 해석. 빈 칸 = 지우기({ok, value:null}), 숫자 = {ok, value:N}, 그 외 {ok:false, message}.
 */
export function parseBudgetInput(input) {
  const s = String(input ?? '').trim();
  if (s === '') return { ok: true, value: null };
  const n = parseAmount(s);
  if (n === null) return { ok: false, message: BUDGET_RANGE_TEXT };
  return { ok: true, value: n };
}

/** 입력칸에 채울 현재 값: 12000 -> "12,000", 없으면 "" */
export const budgetDraft = (budget) => (Number.isInteger(budget) ? formatNumber(budget) : '');

export const hasBudget = (item) => !!item && Number.isInteger(item.budget) && item.budget >= 1;

/** 카테고리 행 메타: "예산 N원 · 기록 N건" / "기록 N건" */
export function categoryMeta(item) {
  const used = `기록 ${item.usedCount || 0}건`;
  return hasBudget(item) ? `예산 ${formatWon(item.budget)} · ${used}` : used;
}

/** "예산" 버튼 접근 이름 */
export function budgetButtonLabel(item) {
  return hasBudget(item) ? `${item.name} 예산 바꾸기, 지금 ${formatWon(item.budget)}` : `${item.name} 예산 정하기`;
}

export const budgetSavedText = (name, n) => (n === null ? `'${name}' 예산을 지웠어요` : `'${name}' 예산을 ${formatWon(n)}으로 정했어요`);

/** 남음/초과 문구 */
export function remainText(budget, spent) {
  const diff = budget - spent;
  return diff >= 0 ? `${formatWon(diff)} 남음` : `${formatWon(-diff)} 초과`;
}

/** 대시보드 카드에 올릴 카테고리: 활성 지출 + 예산 있음 */
export function budgetItems(resp) {
  const items = resp && Array.isArray(resp.items) ? resp.items : [];
  return items.filter((i) => i && i.type === 'expense' && i.active && hasBudget(i));
}

/**
 * 카드 데이터. categories: GET /api/categories 응답, stats: stats/categories(expense) 응답.
 * rows: 사용률 높은 순(초과가 위), 동률은 sortOrder, 이름. total: 합계 줄.
 */
export function buildBudgetCard(categories, stats) {
  const spentBy = new Map();
  for (const it of (stats && Array.isArray(stats.items) ? stats.items : [])) {
    if (it && typeof it.category === 'string') spentBy.set(it.category, it.total || 0);
  }
  const rows = budgetItems(categories).map((c) => {
    const spent = spentBy.get(c.name) || 0;
    const over = spent > c.budget;
    return {
      name: c.name, color: c.color, sortOrder: c.sortOrder ?? 0, budget: c.budget, spent, over,
      percent: Math.min(100, Math.round((spent / c.budget) * 1000) / 10),
      remain: remainText(c.budget, spent),
      label: `${c.name}, ${formatWon(c.budget)} 중 ${formatWon(spent)} 사용, ${remainText(c.budget, spent)}`,
      _rate: spent / c.budget,
    };
  });
  rows.sort((a, b) => b._rate - a._rate || a.sortOrder - b.sortOrder || String(a.name).localeCompare(String(b.name), 'ko'));
  const budget = rows.reduce((s, r) => s + r.budget, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  const over = spent > budget;
  return {
    rows,
    total: {
      count: rows.length, budget, spent, over,
      percent: budget > 0 ? Math.min(100, Math.round((spent / budget) * 1000) / 10) : 0,
      text: `예산 ${formatWon(budget)} 중 ${formatWon(spent)} 썼어요 · ${remainText(budget, spent)}`,
      note: `예산을 정한 ${rows.length}개 카테고리 기준`,
    },
  };
}

/**
 * 입력 중 표시값. 숫자·쉼표만 있고 0 으로 시작하지 않을 때만 쉼표를 정리한다.
 * 그 밖의 입력(0, abc 등)은 원문 그대로 두어야 저장 때 검증 오류가 나고, 빈 칸으로 오해해 예산이 지워지지 않는다.
 */
export function budgetInputDisplay(raw) {
  const s = String(raw ?? '');
  if (!/^[0-9,]*$/.test(s) || s.replace(/,/g, '').startsWith('0')) return s;
  return formatAmountInput(s);
}
