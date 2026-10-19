import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickSuggestions } from '../rules/quick.js';
import { autocomplete } from '../rules/autocomplete.js';
import { detectRecurring } from '../rules/recurring.js';
import { detectOverspending } from '../rules/overspending.js';
import { detectLargeExpenses } from '../rules/large.js';
import { addDays, addMonths, todayInSeoul, weekday } from '../lib/dates.js';

let seq = 0;
const tx = (date, amount, o = {}) => ({
  id: `t${++seq}`,
  type: 'expense',
  amount,
  category: '카페/간식',
  memo: '',
  date,
  createdAt: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  ...o,
});
const TODAY = '2026-10-19'; // 월요일

test('C35 today 기본값은 Asia/Seoul: UTC 2026-10-18T16:00Z -> 2026-10-19', () => {
  assert.equal(todayInSeoul(new Date('2026-10-18T16:00:00Z')), '2026-10-19');
  assert.equal(todayInSeoul(new Date('2026-10-18T14:59:59Z')), '2026-10-18');
});

test('날짜 유틸: addDays/addMonths/weekday', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(weekday('2026-10-19'), 1);
});

// ---- R1 ----
test('C14 R1: 3건 제안, 2건 제외, 91일 전 거래는 건수 제외', () => {
  const three = [0, 1, 2].map((i) => tx(addDays(TODAY, -i), 4500, { memo: '스타벅스' }));
  assert.equal(quickSuggestions(three, 'expense', TODAY).length, 1);
  assert.equal(quickSuggestions(three.slice(0, 2), 'expense', TODAY).length, 0);
  // 90일 창: today-89 포함, today-90(=91번째 날) 제외
  const edge = [tx(addDays(TODAY, -89), 4500, { memo: 'a' }), tx(addDays(TODAY, -1), 4500, { memo: 'a' }), tx(TODAY, 4500, { memo: 'a' })];
  assert.equal(quickSuggestions(edge, 'expense', TODAY).length, 1);
  const out = [tx(addDays(TODAY, -90), 4500, { memo: 'a' }), tx(addDays(TODAY, -1), 4500, { memo: 'a' }), tx(TODAY, 4500, { memo: 'a' })];
  assert.equal(quickSuggestions(out, 'expense', TODAY).length, 0);
  // 메모 없음/다른 type 제외, 정규화 키로 묶음
  const mixed = [tx(TODAY, 1, { memo: ' GS25 ' }), tx(addDays(TODAY, -1), 1, { memo: 'gs25' }), tx(addDays(TODAY, -2), 1, { memo: 'GS25' })];
  const r = quickSuggestions(mixed, 'expense', TODAY);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 3);
  assert.equal(quickSuggestions(mixed, 'income', TODAY).length, 0);
});

test('C15 R1: 최빈값 대표 금액, 동률이면 최근 금액, 최대 5개', () => {
  const g = [tx('2026-10-10', 4500, { memo: 'x' }), tx('2026-10-11', 5000, { memo: 'x' }), tx('2026-10-12', 4500, { memo: 'x' })];
  assert.equal(quickSuggestions(g, 'expense', TODAY)[0].amount, 4500);
  const tie = [tx('2026-10-10', 4500, { memo: 'x' }), tx('2026-10-11', 5000, { memo: 'x' }), tx('2026-10-12', 5000, { memo: 'x' }), tx('2026-10-13', 4500, { memo: 'x' })];
  assert.equal(quickSuggestions(tie, 'expense', TODAY)[0].amount, 4500, '동률이면 가장 최근 거래의 금액');
  const many = [];
  for (let m = 0; m < 7; m++) for (let i = 0; i < 3; i++) many.push(tx(addDays(TODAY, -i), 1000, { memo: `m${m}` }));
  assert.equal(quickSuggestions(many, 'expense', TODAY).length, 5);
});

test('C16 R1: 오늘 요일 2건 이상 그룹이 건수 많은 그룹보다 앞, weekdayMatch', () => {
  const many = [];
  // 5건이지만 오늘(월)과 다른 요일들
  for (let i = 1; i <= 5; i++) many.push(tx(addDays(TODAY, -i), 100, { memo: '많이', category: '식비' }));
  // 3건, 그중 2건이 월요일(7일 전, 14일 전)
  const wd = [tx(addDays(TODAY, -7), 100, { memo: '월요일' }), tx(addDays(TODAY, -14), 100, { memo: '월요일' }), tx(addDays(TODAY, -3), 100, { memo: '월요일' })];
  const r = quickSuggestions([...many, ...wd], 'expense', TODAY);
  assert.equal(r[0].memo, '월요일');
  assert.equal(r[0].weekdayMatch, true);
  assert.equal(r[1].memo, '많이');
  assert.equal(r[1].weekdayMatch, false);
  // 요일 일치는 56일 창: 57일 전은 제외
  const old = [tx(addDays(TODAY, -56), 1, { memo: 'o' }), tx(addDays(TODAY, -63), 1, { memo: 'o' }), tx(addDays(TODAY, -1), 1, { memo: 'o' })];
  assert.equal(quickSuggestions(old, 'expense', TODAY)[0].weekdayMatch, false);
});

// ---- R2 ----
test('C17 R2: 접두 일치, 빈 q, 대소문자 무시, 포함 보충', () => {
  const txs = [
    tx('2026-10-01', 4500, { memo: '스타벅스', category: '카페/간식' }),
    tx('2026-10-05', 5000, { memo: '스타벅스', category: '식비' }),
    tx('2026-10-10', 5500, { memo: '스타벅스', category: '카페/간식' }),
    tx('2026-10-11', 3000, { memo: 'gs25', category: '식비' }),
    tx('2026-10-12', 3000, { memo: '오늘 스타일', category: '쇼핑' }),
  ];
  const r = autocomplete(txs, '스타', 'expense', TODAY);
  assert.equal(r[0].memo, '스타벅스');
  assert.equal(r[0].category, '카페/간식', '가장 많이 쓴 카테고리');
  assert.equal(r[0].amount, 5500, '가장 최근 금액');
  assert.equal(r[1].memo, '오늘 스타일', '시작 일치가 5개 미만이면 포함 일치로 보충');
  assert.deepEqual(autocomplete(txs, '', 'expense', TODAY), []);
  assert.deepEqual(autocomplete(txs, '   ', 'expense', TODAY), []);
  assert.equal(autocomplete(txs, 'GS', 'expense', TODAY)[0].memo, 'gs25');
  assert.deepEqual(autocomplete(txs, "'", 'expense', TODAY), []);
  // 180일 창
  assert.deepEqual(autocomplete([tx(addDays(TODAY, -180), 1, { memo: 'old' })], 'old', 'expense', TODAY), []);
  assert.equal(autocomplete([tx(addDays(TODAY, -179), 1, { memo: 'old' })], 'old', 'expense', TODAY).length, 1);
});

// ---- R3 ----
const series = (start, gaps, amount = 17000, memo = '넷플릭스') => {
  const out = [];
  let d = start;
  out.push(tx(d, amount, { memo }));
  for (const g of gaps) {
    d = addDays(d, g);
    out.push(tx(d, amount, { memo }));
  }
  return out;
};

test('C18 R3 월간: 30일 간격 3건 감지/nextDate, 2건 미감지, 40일 간격 미감지', () => {
  const ok = series('2026-07-20', [30, 30]); // 마지막 2026-09-18
  const r = detectRecurring(ok, TODAY);
  assert.equal(r.length, 1);
  assert.equal(r[0].period, 'monthly');
  assert.equal(r[0].lastDate, '2026-09-18');
  assert.equal(r[0].nextDate, '2026-10-18');
  assert.equal(r[0].occurrences, 3);
  assert.equal(detectRecurring(series('2026-08-19', [30]), TODAY).length, 0);
  assert.equal(detectRecurring(series('2026-06-01', [40, 30]), TODAY).length, 0);
  // 경계: 26, 35 허용 / 25, 36 불허
  assert.equal(detectRecurring(series('2026-08-01', [26, 35]), TODAY).length, 1);
  assert.equal(detectRecurring(series('2026-08-01', [25, 30]), TODAY).length, 0);
  assert.equal(detectRecurring(series('2026-08-01', [30, 36]), TODAY).length, 0);
});

test('C19 R3 금액: +10% 이내 감지, +11% 미감지', () => {
  const mk = (third) => {
    const s = series('2026-07-20', [30, 30], 10000);
    s[2].amount = third;
    return s;
  };
  assert.equal(detectRecurring(mk(11000), TODAY).length, 1);
  assert.equal(detectRecurring(mk(11100), TODAY).length, 0);
});

test('C20 R3 주간: 7일 간격 4건 감지, 3건 미감지, 마지막 후 9일이면 제외', () => {
  const four = series('2026-09-28', [7, 7, 7], 4500, '스타벅스'); // 마지막 10-19
  assert.equal(detectRecurring(four, TODAY)[0].period, 'weekly');
  assert.equal(detectRecurring(series('2026-10-05', [7, 7], 4500, '스타벅스'), TODAY).length, 0);
  const last = series('2026-09-17', [7, 7, 7]); // 마지막 10-08 -> 11일 경과
  assert.equal(detectRecurring(last, TODAY).length, 0);
  const s = series('2026-09-18', [7, 7, 7], 4500, 'w'); // 마지막 10-09
  assert.equal(detectRecurring(s, '2026-10-17').length, 1, '8일 경과는 포함');
  assert.equal(detectRecurring(s, '2026-10-18').length, 0, '9일 경과는 제외');
});

test('C21 R3 dueSoon: nextDate = today+3 true, today+4 false', () => {
  const mk = (daysAhead) => {
    // 마지막 거래 = nextDate - 30
    const next = addDays(TODAY, daysAhead);
    const last = addDays(next, -30);
    return series(addDays(last, -60), [30, 30]);
  };
  assert.equal(detectRecurring(mk(3), TODAY)[0].dueSoon, true);
  assert.equal(detectRecurring(mk(4), TODAY)[0].dueSoon, false);
  assert.equal(detectRecurring(mk(0), TODAY)[0].dueSoon, true);
  assert.equal(detectRecurring(mk(-1), TODAY)[0].dueSoon, false);
});

test('R3: 메모 없으면 (type, category, amount) 일치로 묶고, 같은 날짜 중복은 1건', () => {
  const noMemo = series('2026-07-20', [30, 30], 9900, '');
  assert.equal(detectRecurring(noMemo, TODAY).length, 1);
  const dup = [...series('2026-08-19', [30]), tx('2026-08-19', 17000, { memo: '넷플릭스' })];
  assert.equal(detectRecurring(dup, TODAY).length, 0, '같은 날 2건은 1건으로 계산 -> 2건');
  const other = series('2026-07-20', [30, 30], 9900, '').map((t) => ({ ...t, amount: t.amount + 1 }));
  other[0].amount = 5000;
  assert.equal(detectRecurring(other, TODAY).length, 0);
});

// ---- R4 ----
const monthExpenses = (month, total, category = '식비') => [tx(`${month}-10`, total, { category })];
const base3 = (each) => ['2026-07', '2026-08', '2026-09'].flatMap((m) => monthExpenses(m, each));

test('C22 R4 exceeded: baseline 100,000 -> 120,000 exceeded, 119,999 아님', () => {
  const r = detectOverspending([...base3(100000), ...monthExpenses('2026-10', 120000)], '2026-10', '2026-10-31');
  assert.equal(r[0].level, 'exceeded');
  assert.equal(r[0].baseline, 100000);
  assert.equal(r[0].ratio, 1.2);
  assert.equal(r[0].projectedTotal, null);
  const none = detectOverspending([...base3(100000), ...monthExpenses('2026-10', 119999)], '2026-10', '2026-10-31');
  assert.equal(none.length, 0);
});

test('C24 R4 제외: 기록 1개월뿐, baseline 9,999원', () => {
  const one = [...monthExpenses('2026-09', 200000), ...monthExpenses('2026-10', 300000)];
  assert.equal(detectOverspending(one, '2026-10', '2026-10-31').length, 0);
  const small = [...base3(9999), ...monthExpenses('2026-10', 99999)];
  assert.equal(detectOverspending(small, '2026-10', '2026-10-31').length, 0);
  const edge = [...base3(10000), ...monthExpenses('2026-10', 12000)];
  assert.equal(detectOverspending(edge, '2026-10', '2026-10-31').length, 1, 'baseline 10,000 은 판정');
  // 기록 있는 달 2개월이면 판정 (기록 없는 달은 평균에서 제외)
  const two = [...monthExpenses('2026-08', 100000), ...monthExpenses('2026-09', 100000), ...monthExpenses('2026-10', 120000)];
  assert.equal(detectOverspending(two, '2026-10', '2026-10-31')[0].baseline, 100000);
  // income 은 대상 아님
  const inc = [...base3(100000), tx('2026-10-10', 999999, { type: 'income', category: '급여' })];
  assert.equal(detectOverspending(inc, '2026-10', '2026-10-31').length, 0);
});

test('R4 정렬: exceeded 먼저, ratio 내림차순', () => {
  const txs = [
    ...base3(100000),
    ...monthExpenses('2026-10', 130000, '식비'),
    ...['2026-07', '2026-08', '2026-09'].flatMap((m) => monthExpenses(m, 50000, '쇼핑')),
    ...monthExpenses('2026-10', 90000, '쇼핑'),
  ];
  const r = detectOverspending(txs, '2026-10', '2026-10-31');
  assert.deepEqual(r.map((x) => x.category), ['쇼핑', '식비']);
});

// ---- R5 ----
const comps = (n, amount = 10000, category = '쇼핑') =>
  Array.from({ length: n }, (_, i) => tx(addDays('2026-10-10', -(i + 1)), amount, { category }));

test('C25 R5: 중앙값 10,000 비교군 5건 - 30,001 표시, 30,000 미표시, 비교군 4건 미표시', () => {
  const big = (amount, n) => [...comps(n), tx('2026-10-10', amount, { category: '쇼핑', memo: '패딩' })];
  const r = detectLargeExpenses(big(30001, 5), '2026-10');
  assert.equal(r.length, 1);
  assert.equal(r[0].median, 10000);
  assert.equal(r[0].multiple, 3);
  assert.equal(r[0].memo, '패딩');
  assert.equal(detectLargeExpenses(big(30000, 5), '2026-10').length, 0);
  assert.equal(detectLargeExpenses(big(30001, 4), '2026-10').length, 0);
});

test('R5: 비교군은 같은 카테고리 지출만, 해당 월만 대상, date 내림차순 최대 10개', () => {
  const other = [...comps(5, 10000, '식비'), tx('2026-10-10', 90000, { category: '쇼핑' })];
  assert.equal(detectLargeExpenses(other, '2026-10').length, 0);
  const inc = [...comps(5).map((t) => ({ ...t, type: 'income' })), tx('2026-10-10', 90000, { category: '쇼핑' })];
  assert.equal(detectLargeExpenses(inc, '2026-10').length, 0);
  // 다른 달 거래는 대상 아님
  assert.equal(detectLargeExpenses([...comps(5), tx('2026-11-10', 90000, { category: '쇼핑' })], '2026-10').length, 0);
  // 12건이 모두 크면 10개로 제한, 최신 날짜 먼저
  const hist = Array.from({ length: 40 }, (_, i) => tx(addDays('2026-10-01', -(i + 1)), 1000, { category: '쇼핑' }));
  const bigs = Array.from({ length: 12 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 100000, { category: '쇼핑' }));
  const r = detectLargeExpenses([...hist, ...bigs], '2026-10');
  assert.equal(r.length, 10);
  assert.equal(r[0].date, '2026-10-12');
});
