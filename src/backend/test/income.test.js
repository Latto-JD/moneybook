// I1 수입 감소 / I2 반복 수입 누락 (plan-followup 13.7, api.md 6.3)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { detectIncomeDrops, detectMissingIncome } from '../rules/income.js';
import { detectRecurring } from '../rules/recurring.js';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';

let seq = 0;
const inc = (date, amount, category = '급여', memo = '급여') => ({
  id: `i${++seq}`,
  type: 'income',
  amount,
  category,
  memo,
  date,
  createdAt: `2026-01-01T00:00:00.${String(seq).padStart(4, '0')}Z`,
});
const exp = (date, amount, category = '식비', memo = '') => ({ ...inc(date, amount, category, memo), type: 'expense' });
const salary3 = (each = 2_500_000, category = '급여') =>
  ['2026-06', '2026-07', '2026-08'].map((m) => inc(`${m}-25`, each, category, `월급${m}`));
const drops = (txs, month = '2026-09', today = '2026-10-05') => detectIncomeDrops(txs, month, today);

test('I1 경계: baseline 2,500,000 의 0.8 = 2,000,000 정확히 포함, 2,000,001 제외', () => {
  const r = drops([...salary3(), inc('2026-09-25', 2_000_000, '급여', 'x')]);
  assert.deepEqual(r, [{ category: '급여', currentTotal: 2_000_000, baseline: 2_500_000, ratio: 0.8 }]);
  assert.deepEqual(drops([...salary3(), inc('2026-09-25', 2_000_001, '급여', 'x')]), []);
});

test('I1 그 달 수입이 없으면 currentTotal 0 항목, 월 합계는 같은 달 여러 건을 더한다', () => {
  assert.deepEqual(drops(salary3()), [{ category: '급여', currentTotal: 0, baseline: 2_500_000, ratio: 0 }]);
  const split = [...salary3(), inc('2026-09-05', 900_000, '급여', 'a'), inc('2026-09-25', 900_000, '급여', 'b')];
  assert.equal(drops(split)[0].currentTotal, 1_800_000);
  assert.equal(drops(split)[0].ratio, 0.72);
});

test('I1 기록 있는 달 수: k=2 는 판정(합계 평균), k=1 은 판정 안 함, 기록 없는 달은 평균에서 제외', () => {
  const two = [inc('2026-07-25', 3_000_000, '급여', 'a'), inc('2026-08-25', 2_000_000, '급여', 'b')]; // baseline 2,500,000
  assert.deepEqual(drops(two).map((x) => x.baseline), [2_500_000]);
  assert.deepEqual(drops([two[1]]), []);
  assert.deepEqual(drops([inc('2026-08-25', 2_000_000)]), []);
});

test('I1 baseline 9,999 는 제외, 10,000 은 판정', () => {
  const mk = (each) => ['2026-06', '2026-07', '2026-08'].map((m) => inc(`${m}-25`, each, '용돈', 'u'));
  assert.deepEqual(drops(mk(9_999), '2026-09'), []);
  assert.equal(drops(mk(10_000), '2026-09').length, 1);
});

test('I1 끝난 달만: 이번 달·미래 달은 빈 배열, 지출·기준 밖 달은 무시', () => {
  const txs = [...salary3(), exp('2026-09-03', 50_000)];
  assert.equal(drops(txs, '2026-09', '2026-10-01').length, 1, '9월은 10월 1일에 끝난 달');
  assert.deepEqual(drops(salary3(), '2026-09', '2026-09-30'), [], '이번 달');
  assert.deepEqual(drops(salary3(), '2026-09', '2026-08-31'), [], '미래 달');
  // 직전 3개월 밖(5월) 수입은 baseline 에 안 들어감
  assert.deepEqual(drops([inc('2026-05-25', 9_000_000), inc('2026-08-25', 2_000_000)]), []);
});

test('I1 정렬: ratio 오름차순 -> sortOrder -> 가나다, 카테고리당 1개', () => {
  const mk = (cat, each, cur) => [
    ...['2026-06', '2026-07', '2026-08'].map((m) => inc(`${m}-10`, each, cat, `${cat}${m}`)),
    ...(cur ? [inc('2026-09-10', cur, cat, `${cat}cur`)] : []),
  ];
  const txs = [...mk('급여', 1_000_000, 500_000), ...mk('부수입', 1_000_000, 100_000), ...mk('용돈', 1_000_000, 500_000)];
  const order = { 급여: 2, 용돈: 1, 부수입: 3 };
  const r = detectIncomeDrops(txs, '2026-09', '2026-10-05', (type, c) => order[c]);
  assert.deepEqual(r.map((x) => x.category), ['부수입', '용돈', '급여']);
});

// ---- I2 ----
const monthly = (memo = '급여', amount = 2_500_000, dates = ['2026-07-25', '2026-08-25', '2026-09-25']) =>
  dates.map((d) => inc(d, amount, '급여', memo));
const missing = (txs, today, month = today.slice(0, 7)) => detectMissingIncome(txs, month, today);

test('I2 유예: 예상일 10-26 에 오늘이 +2일은 없음, +3일은 있음', () => {
  assert.deepEqual(missing(monthly(), '2026-10-28'), []);
  assert.deepEqual(missing(monthly(), '2026-10-29'), [
    { memo: '급여', category: '급여', amount: 2_500_000, lastDate: '2026-09-25', expectedDate: '2026-10-26' },
  ]);
});

test('I2 이번 달에 같은 그룹 거래가 있으면 없음(미래 날짜 미리 입력 포함), 다른 메모는 무관', () => {
  const today = '2026-10-29';
  assert.deepEqual(missing([...monthly(), inc('2026-10-02', 2_500_000, '급여', '급여')], today), []);
  assert.deepEqual(missing([...monthly(), inc('2026-10-30', 2_500_000, '급여', '급여')], today), [], '미리 입력');
  assert.equal(missing([...monthly(), inc('2026-10-02', 100, '급여', '다른 메모')], today).length, 1);
});

test('I2 70일 창: 마지막+70일까지는 있고 다음 날은 없음', () => {
  const txs = monthly('급여', 2_500_000, ['2026-04-25', '2026-05-25', '2026-06-25']); // 마지막 06-25, 70일 뒤 09-03
  assert.equal(detectMissingIncome(txs, '2026-09', '2026-09-03').length, 1);
  assert.deepEqual(detectMissingIncome(txs, '2026-09', '2026-09-04'), []);
  assert.deepEqual(detectRecurring(txs, '2026-09-03'), [], 'R3 는 35일 뒤 비활성');
});

test('I2 이번 달이 아닌 달 조회는 빈 배열, 지출·주간 반복은 대상 아님', () => {
  assert.deepEqual(missing(monthly(), '2026-10-29', '2026-09'), []);
  assert.deepEqual(missing(monthly(), '2026-10-29', '2026-11'), []);
  const spend = ['2026-07-25', '2026-08-25', '2026-09-25'].map((d) => exp(d, 17_000, '문화/여가', '넷플릭스'));
  assert.deepEqual(missing(spend, '2026-10-29'), []);
  const weekly = ['09-01', '09-08', '09-15', '09-22'].map((d) => inc(`2026-${d}`, 50_000, '용돈', '주급'));
  assert.deepEqual(missing(weekly, '2026-10-05'), []);
});

test('I2 메모 없는 그룹은 카테고리+금액으로 묶이고 금액이 달라지면 안 묶임', () => {
  const same = ['2026-07-25', '2026-08-25', '2026-09-25'].map((d) => inc(d, 300_000, '부수입', ''));
  const r = missing(same, '2026-10-29');
  assert.deepEqual(r.map((x) => [x.memo, x.category, x.amount]), [['', '부수입', 300_000]]);
  const diff = [inc('2026-07-25', 300_000, '부수입', ''), inc('2026-08-25', 310_000, '부수입', ''), inc('2026-09-25', 320_000, '부수입', '')];
  assert.deepEqual(missing(diff, '2026-10-29'), []);
});

test('I2 정렬: expectedDate 오름차순 -> memo 가나다, 금액은 중앙값 반올림', () => {
  const a = ['2026-07-20', '2026-08-20', '2026-09-20'].map((d, i) => inc(d, [100_001, 100_002, 100_004][i], '급여', '나'));
  const b = ['2026-07-10', '2026-08-10', '2026-09-10'].map((d) => inc(d, 50_000, '용돈', '다'));
  const c = ['2026-07-20', '2026-08-20', '2026-09-20'].map((d) => inc(d, 70_000, '부수입', '가'));
  const r = missing([...a, ...b, ...c], '2026-10-29');
  assert.deepEqual(r.map((x) => x.memo), ['다', '가', '나']);
  assert.equal(r[2].amount, 100_002);
});

test('R3 결과는 옵션이 없으면 불변(35일 뒤 비활성)', () => {
  const txs = monthly();
  assert.deepEqual(detectRecurring(txs, '2026-10-05').map((x) => x.nextDate), ['2026-10-26']);
  assert.deepEqual(detectRecurring(txs, '2026-10-29').map((x) => x.nextDate), ['2026-10-26']);
  assert.deepEqual(detectRecurring(txs, '2026-11-05'), []);
});

// ---- HTTP ----
let app;
before(async () => {
  app = await startApp({}, { now: () => new Date('2026-10-29T03:00:00Z') });
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from transactions; delete from auth_attempts; delete from sessions; delete from users;');
});

test('GET /api/insights 응답에 incomeDrops·missingIncome 추가, 기존 키 유지', async () => {
  const r = await app.request('POST', '/api/auth/signup', { body: { email: 'i@example.com', password: GOOD_PASSWORD, name: '테스터' } });
  const cookie = cookieFrom(r);
  const post = (body) => app.request('POST', '/api/transactions', { body, cookie });
  for (const d of ['2026-06-25', '2026-07-25', '2026-08-25', '2026-09-25']) {
    assert.equal((await post({ type: 'income', amount: 2_500_000, category: '급여', memo: '급여', date: d })).status, 201);
  }
  const now = (await app.request('GET', '/api/insights?month=2026-10', { cookie })).json;
  assert.deepEqual(Object.keys(now), ['month', 'recurring', 'overspending', 'largeExpenses', 'incomeDrops', 'missingIncome']);
  assert.deepEqual(now.incomeDrops, []);
  assert.deepEqual(now.missingIncome, [
    { memo: '급여', category: '급여', amount: 2_500_000, lastDate: '2026-09-25', expectedDate: '2026-10-26' },
  ]);
  const sep = (await app.request('GET', '/api/insights?month=2026-09', { cookie })).json;
  assert.deepEqual([sep.incomeDrops, sep.missingIncome], [[], []]);
  const oct = (await app.request('GET', '/api/insights?month=2026-10&today=2026-11-02', { cookie })).json;
  assert.equal(oct.incomeDrops[0].currentTotal, 0);
  assert.deepEqual(oct.missingIncome, []);
});
