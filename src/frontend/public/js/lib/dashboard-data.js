// 대시보드 API 응답 -> 화면용 값 어댑터 (순수 함수). 필드는 docs/api.md 5장 기준.
import { shiftMonth } from './date.js';

/**
 * KPI: stats/monthly 의 months 와 기준 월에서 수입/지출/잔액/지출 전월 대비를 계산.
 * change: null(전월 지출 0 또는 전월 행 없음) | { direction:'up'|'down'|'same', percent:number(소수 첫째 자리), text }
 */
export function buildKpi(months, baseMonth) {
  const rows = Array.isArray(months) ? months : [];
  const cur = rows.find((r) => r.month === baseMonth) || { incomeTotal: 0, expenseTotal: 0, balance: 0 };
  const prev = rows.find((r) => r.month === shiftMonth(baseMonth, -1));
  const income = cur.incomeTotal || 0;
  const expense = cur.expenseTotal || 0;
  const balance = Number.isFinite(cur.balance) ? cur.balance : income - expense;
  const prevExpense = prev ? prev.expenseTotal || 0 : 0;
  return { income, expense, balance, prevExpense, change: expenseChange(expense, prevExpense) };
}

export const NO_PREV_TEXT = '비교할 지난달 기록이 없어요';

export function expenseChange(expense, prevExpense) {
  if (!(prevExpense > 0)) return null;
  if (expense === prevExpense) return { direction: 'same', percent: 0, text: '지난달과 같아요' };
  const pct = Math.round((Math.abs(expense - prevExpense) / prevExpense) * 1000) / 10;
  const up = expense > prevExpense;
  return {
    direction: up ? 'up' : 'down',
    percent: pct,
    text: `지난달보다 ${pct.toFixed(1)}% ${up ? '더 썼어요' : '덜 썼어요'}`,
  };
}

/** stats/categories -> 도넛 입력 [{label, value}] (이미 total 내림차순) */
export function donutItemsFrom(resp) {
  const items = resp && Array.isArray(resp.items) ? resp.items : [];
  return items.filter((i) => i && i.total > 0).map((i) => ({ label: i.category, value: i.total }));
}

/** stats/category-monthly -> 칩 목록 [{category, index}] (sum 내림차순 그대로) */
export function trendCategories(resp) {
  const series = resp && Array.isArray(resp.series) ? resp.series : [];
  return series.map((s, index) => ({ category: s.category, index }));
}

/** 기본 선택 카테고리: 기준 월 지출 1위(categories.items[0]) 가 series 에 있으면 그것, 아니면 series 첫째. 없으면 null. */
export function defaultTrendCategory(categoriesResp, trendResp) {
  const series = trendResp && Array.isArray(trendResp.series) ? trendResp.series : [];
  if (series.length === 0) return null;
  const top = categoriesResp && Array.isArray(categoriesResp.items) && categoriesResp.items[0]
    ? categoriesResp.items[0].category : null;
  if (top && series.some((s) => s.category === top)) return top;
  return series[0].category;
}

/** 선택한 카테고리의 시리즈를 renderBars 입력으로. 없으면 null. */
export function seriesFor(trendResp, category) {
  const series = trendResp && Array.isArray(trendResp.series) ? trendResp.series : [];
  const index = series.findIndex((s) => s.category === category);
  if (index < 0) return null;
  return { seriesName: category, months: trendResp.months || [], totals: series[index].totals || [], colorIndex: index };
}
