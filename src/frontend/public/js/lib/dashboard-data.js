// 대시보드 API 응답 -> 화면용 값 어댑터 (순수 함수). 필드는 docs/api.md 5장 기준.
import { shiftMonth, monthTitle, monthShort } from './date.js';

/**
 * 보고 있는 달 이름: 이번 달 '이번 달', 같은 해 다른 달 '10월', 다른 해 '2025년 12월'.
 * base, thisMonth: 'YYYY-MM'
 */
export function viewedMonthName(base, thisMonth) {
  if (base === thisMonth) return '이번 달';
  if (String(base).slice(0, 4) === String(thisMonth).slice(0, 4)) return monthShort(base);
  return monthTitle(base);
}
export const balanceLabel = (base, thisMonth) => `${viewedMonthName(base, thisMonth)} 남은 돈`;
export const summaryLabel = (base, thisMonth) => `${viewedMonthName(base, thisMonth)} 요약`;

/**
 * KPI: stats/monthly 의 months 와 기준 월에서 수입/지출/잔액과 수입·지출 각각의 전월 대비를 계산.
 * incomeChange / expenseChange: null(전월 0 또는 전월 행 없음) | { direction:'up'|'down'|'same', percent:number(소수 첫째 자리), text }
 */
export function buildKpi(months, baseMonth) {
  const rows = Array.isArray(months) ? months : [];
  const cur = rows.find((r) => r.month === baseMonth) || { incomeTotal: 0, expenseTotal: 0, balance: 0 };
  const prev = rows.find((r) => r.month === shiftMonth(baseMonth, -1));
  const income = cur.incomeTotal || 0;
  const expense = cur.expenseTotal || 0;
  const balance = Number.isFinite(cur.balance) ? cur.balance : income - expense;
  const prevIncome = prev ? prev.incomeTotal || 0 : 0;
  const prevExpense = prev ? prev.expenseTotal || 0 : 0;
  return {
    income, expense, balance, prevIncome, prevExpense,
    incomeChange: amountChange(income, prevIncome, '수입'),
    expenseChange: amountChange(expense, prevExpense, '지출'),
  };
}

export const NO_PREV_TEXT = '비교할 지난달 기록이 없어요';

/** 수입·지출에 같은 문장 형식을 쓴다: "지난달보다 수입이 5.0% 늘었어요" (좋고 나쁨을 가르지 않는다). noun: '수입' | '지출' */
export function amountChange(value, prevValue, noun) {
  if (!(prevValue > 0)) return null;
  if (value === prevValue) return { direction: 'same', percent: 0, text: '지난달과 같아요' };
  const pct = Math.round((Math.abs(value - prevValue) / prevValue) * 1000) / 10;
  const up = value > prevValue;
  return {
    direction: up ? 'up' : 'down',
    percent: pct,
    text: `지난달보다 ${noun}이 ${pct.toFixed(1)}% ${up ? '늘었어요' : '줄었어요'}`,
  };
}
export const incomeChange = (value, prev) => amountChange(value, prev, '수입');
export const expenseChange = (value, prev) => amountChange(value, prev, '지출');

/** stats/categories -> 도넛 입력 [{label, value}] (이미 total 내림차순) */
export function donutItemsFrom(resp) {
  const items = resp && Array.isArray(resp.items) ? resp.items : [];
  return items.filter((i) => i && i.total > 0).map((i) => ({ label: i.category, value: i.total }));
}

export const DONUT_MAX_PIECES = 8;

/**
 * 도넛 조각 수를 최대 8개로 줄인다: 금액 내림차순 상위 7개 + 나머지를 "그 외 N개" 1조각으로 묶는다.
 * 나머지가 1개뿐이면 묶지 않고 그대로 8개. 묶음은 members(묶인 항목, 금액 내림차순)를 가지며 항상 마지막(pinLast).
 * 이름을 "기타" 로 하지 않는다: 사용자 카테고리 "기타" 와 구분되어야 한다.
 */
export function groupDonutItems(items, max = DONUT_MAX_PIECES) {
  const list = (Array.isArray(items) ? items : [])
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it && typeof it.value === 'number' && Number.isFinite(it.value) && it.value > 0)
    .sort((a, b) => b.it.value - a.it.value || a.i - b.i)
    .map(({ it }) => it);
  if (list.length <= max) return list;
  const head = list.slice(0, max - 1);
  const rest = list.slice(max - 1);
  return [...head, {
    label: `그 외 ${rest.length}개`,
    value: rest.reduce((a, it) => a + it.value, 0),
    members: rest,
    pinLast: true,
  }];
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

/**
 * 균형 카드의 두 막대 비율(0~100, 소수 첫째 자리). 수입·지출이 같은 기준(둘 중 큰 값)을 쓴다.
 * 둘 다 0 이면 0/0 (NaN 없음).
 */
export function balanceBars(income, expense) {
  const inc = Number.isFinite(income) && income > 0 ? income : 0;
  const exp = Number.isFinite(expense) && expense > 0 ? expense : 0;
  const base = Math.max(inc, exp);
  if (base <= 0) return { income: 0, expense: 0 };
  const pct = (v) => Math.round((v / base) * 1000) / 10;
  return { income: pct(inc), expense: pct(exp) };
}
