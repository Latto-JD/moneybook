// I1 수입 감소 / I2 반복 수입 누락 - 순수 함수 (api.md 6.3, 수입 규칙)
import { addDays, addMonths } from '../lib/dates.js';
import { categoryOrder } from '../lib/categories.js';
import { koCompare } from './common.js';
import { detectRecurringGroups, recurringGroupKey } from './recurring.js';

export const INCOME_DROP = {
  baselineMonths: 3,
  minBaselineMonths: 2,
  minBaseline: 10_000,
  dropRatio: [4, 5], // 0.8
};

export const MISSING_INCOME = {
  activeDays: 70,
  graceDays: 3,
};

const round2 = (x) => Math.round(x * 100) / 100;

// month: 'YYYY-MM', today: 'YYYY-MM-DD'. 조회 달이 today 의 달보다 앞선(끝난) 달일 때만 판정한다.
// orderOf(type, category): 정렬 동률 기준(사용자 카테고리 sortOrder). 생략하면 기본 세트 순서.
export function detectIncomeDrops(transactions, month, today, orderOf = categoryOrder) {
  if (month >= today.slice(0, 7)) return [];
  const prevMonths = Array.from({ length: INCOME_DROP.baselineMonths }, (_, i) => addMonths(month, -(i + 1)));
  const wanted = new Set([month, ...prevMonths]);
  const totals = new Map(); // 카테고리 -> 월 -> 수입 합계
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    const m = t.date.slice(0, 7);
    if (!wanted.has(m)) continue;
    if (!totals.has(t.category)) totals.set(t.category, new Map());
    const byMonth = totals.get(t.category);
    byMonth.set(m, (byMonth.get(m) || 0) + t.amount);
  }
  const [dn, dd] = INCOME_DROP.dropRatio;
  const out = [];
  for (const [category, byMonth] of totals) {
    const prior = prevMonths.map((m) => byMonth.get(m)).filter((v) => v !== undefined && v > 0);
    if (prior.length < INCOME_DROP.minBaselineMonths) continue;
    const sum = prior.reduce((a, b) => a + b, 0);
    const k = prior.length;
    const baseline = sum / k;
    if (baseline < INCOME_DROP.minBaseline) continue;
    const current = byMonth.get(month) || 0;
    // 정수 연산 비교: current <= baseline * 0.8  <=>  current*k*5 <= sum*4
    if (current * k * dd > sum * dn) continue;
    out.push({ category, currentTotal: current, baseline: Math.round(baseline), ratio: round2(current / baseline) });
  }
  out.sort(
    (a, b) =>
      a.ratio - b.ratio ||
      orderOf('income', a.category) - orderOf('income', b.category) ||
      koCompare(a.category, b.category),
  );
  return out;
}

// 조회 달이 today 의 달과 같을 때만 판정한다.
// transactions 에는 이번 달의 미래 날짜 거래(date > today)도 들어 있어야 한다(미리 입력한 수입 판정용).
export function detectMissingIncome(transactions, month, today) {
  if (month !== today.slice(0, 7)) return [];
  const groups = detectRecurringGroups(transactions, today, {
    type: 'income',
    period: 'monthly',
    activeDays: MISSING_INCOME.activeDays,
  });
  const thisMonthKeys = new Set();
  for (const t of transactions) {
    if (t.type === 'income' && t.date.slice(0, 7) === month) thisMonthKeys.add(recurringGroupKey(t));
  }
  const out = [];
  for (const { key, item } of groups) {
    if (today < addDays(item.nextDate, MISSING_INCOME.graceDays)) continue;
    if (thisMonthKeys.has(key)) continue;
    out.push({
      memo: item.memo,
      category: item.category,
      amount: item.amount,
      lastDate: item.lastDate,
      expectedDate: item.nextDate,
    });
  }
  out.sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : a.expectedDate > b.expectedDate ? 1 : koCompare(a.memo, b.memo)));
  return out;
}
