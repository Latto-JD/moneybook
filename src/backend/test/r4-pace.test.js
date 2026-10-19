// R4 v2.1: pace 판정에서 R3 반복 거래 제외 (plan 6장 R4 경계 사례 1~11, C22~C24, C68~C71)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, detectRecurringGroups } from '../rules/recurring.js';
import { detectOverspending } from '../rules/overspending.js';
import { addDays } from '../lib/dates.js';

let seq = 0;
// 비반복은 서로 다른 메모로 기록해 R3 에 감지되지 않게 한다
const t = (date, amount, category, memo = '') => ({
  id: `r${++seq}`,
  type: 'expense',
  amount,
  category,
  memo,
  date,
  createdAt: `2026-01-01T00:00:00.${String(seq).padStart(4, '0')}Z`,
});
const SEP = { month: '2026-09', today: '2026-09-10' };
const run = (txs, month = SEP.month, today = SEP.today) => detectOverspending(txs, month, today);
const base = (category, each = 100000) => ['2026-06', '2026-07', '2026-08'].map((m, i) => t(`${m}-10`, each, category, `기준${i}`));
const hasRec = (txs, memo, period) => detectRecurring(txs, SEP.today).some((r) => r.memo === memo && r.period === period);
const pick = (r) => ({ level: r.level, currentTotal: r.currentTotal, projectedTotal: r.projectedTotal, ratio: r.ratio });

test('C23 pace: 비반복 2건 44,000 -> pace 132,000/1.32, 43,334 pace, 43,333 아님, 경과일 6 판정 안 함', () => {
  const mk = (a, b) => [...base('식비'), t('2026-09-02', a, '식비', '점심'), t('2026-09-05', b, '식비', '저녁')];
  const r = run(mk(20000, 24000));
  assert.equal(r.length, 1);
  assert.deepEqual(pick(r[0]), { level: 'pace', currentTotal: 44000, projectedTotal: 132000, ratio: 1.32 });
  const edge = run(mk(20000, 23334));
  assert.equal(edge.length, 1, '43,334 -> 예상 130,002');
  assert.equal(edge[0].projectedTotal, 130002);
  assert.equal(edge[0].ratio, 1.3);
  assert.equal(run(mk(20000, 23333)).length, 0, '43,333 -> 예상 129,999');
  assert.equal(run(mk(20000, 24000), SEP.month, '2026-09-06').length, 0, '경과일 6');
  assert.equal(run(mk(20000, 24000), SEP.month, '2026-09-07').length, 1, '경과일 7');
});

test('C24 pace: 과거 달 조회는 pace 없음, 한 달 기록/작은 baseline 은 판정 안 함', () => {
  const txs = [...base('식비'), t('2026-09-02', 20000, '식비', '점심'), t('2026-09-05', 24000, '식비', '저녁')];
  assert.equal(run(txs, '2026-08', '2026-09-10').length, 0);
  assert.equal(run(txs, SEP.month, '2026-10-15').length, 0);
  // 미래 달 조회
  assert.equal(run(txs, '2026-10', '2026-09-10').length, 0);
  // baseline 9,999 -> pace/exceeded 모두 판정 안 함
  const small = [...base('식비', 9999), t('2026-09-02', 90000, '식비', 'a'), t('2026-09-05', 90000, '식비', 'b')];
  assert.equal(run(small).length, 0);
});

test('사례 1 (C68): 월세 1건만 -> 항목 없음, recurring 에는 월세', () => {
  const rent = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((d) => t(d, 500000, '주거/통신', '월세'));
  assert.deepEqual(run(rent), []);
  assert.ok(hasRec(rent, '월세', 'monthly'));
});

const rentTxs = (amount09 = 500000) => [
  t('2026-06-01', 500000, '주거/통신', '월세'),
  t('2026-07-01', 500000, '주거/통신', '월세'),
  t('2026-08-01', 500000, '주거/통신', '월세'),
  t('2026-09-01', amount09, '주거/통신', '월세'),
];

test('사례 2 (C68): 월세 + 비반복 소액 2건 -> 항목 없음', () => {
  const txs = [...rentTxs(), t('2026-09-03', 3000, '주거/통신', '전구'), t('2026-09-08', 5000, '주거/통신', '건전지')];
  assert.deepEqual(run(txs), []);
});

test('사례 3 (C22): 월세 + 비반복 100,000 -> exceeded 는 반복 포함 누적 600,000 / 1.2', () => {
  const r = run([...rentTxs(), t('2026-09-05', 100000, '주거/통신', '입주 청소')]);
  assert.equal(r.length, 1);
  assert.deepEqual(pick(r[0]), { level: 'exceeded', currentTotal: 600000, projectedTotal: null, ratio: 1.2 });
});

test('사례 10 (C22): 월세 20% 인상 -> 그룹 미감지, exceeded 600,000 / 1.2', () => {
  const txs = rentTxs(600000);
  assert.equal(hasRec(txs, '월세', 'monthly'), false);
  const r = run(txs);
  assert.equal(r.length, 1);
  assert.deepEqual(pick(r[0]), { level: 'exceeded', currentTotal: 600000, projectedTotal: null, ratio: 1.2 });
});

test('사례 4·5 (C69): 반복 아닌 큰 단건 1건 -> 없음, 소액 1건 추가 -> pace 285,000 / 2.85', () => {
  const one = [...base('쇼핑'), t('2026-09-05', 90000, '쇼핑', '패딩')];
  assert.deepEqual(run(one), []);
  const r = run([...one, t('2026-09-07', 5000, '쇼핑', '양말')]);
  assert.equal(r.length, 1);
  assert.deepEqual(pick(r[0]), { level: 'pace', currentTotal: 95000, projectedTotal: 285000, ratio: 2.85 });
});

test('C69: 비반복 44,000원 1건만 -> 항목 없음', () => {
  assert.deepEqual(run([...base('식비'), t('2026-09-05', 44000, '식비', '회식')]), []);
});

const culture = () => [
  t('2026-06-12', 30000, '문화/여가', '콘서트'),
  t('2026-07-20', 30000, '문화/여가', '전시회'),
  t('2026-08-03', 14900, '문화/여가', '유튜브 프리미엄'),
  t('2026-08-10', 15100, '문화/여가', '영화'),
  t('2026-09-03', 14900, '문화/여가', '유튜브 프리미엄'),
];

test('사례 6·7·8 (C70): R3 조건 못 채운 신규 구독은 반복이 아니다', () => {
  assert.deepEqual(run(culture()), [], '사례 6');
  assert.equal(detectRecurring(culture(), SEP.today).some((r) => r.memo === '유튜브 프리미엄'), false);
  const seven = [...culture(), t('2026-09-06', 15000, '문화/여가', '영화')];
  const r = run(seven);
  assert.equal(r.length, 1);
  assert.deepEqual(pick(r[0]), { level: 'pace', currentTotal: 29900, projectedTotal: 89700, ratio: 2.99 });
  assert.deepEqual(run(seven, SEP.month, '2026-09-06'), [], '사례 8: 경과일 6');
});

const netflix = (sep05Memo = '넷플릭스', bookAmount = 7000) => [
  t('2026-06-05', 17000, '문화/여가', '넷플릭스'),
  t('2026-07-05', 17000, '문화/여가', '넷플릭스'),
  t('2026-08-05', 17000, '문화/여가', '넷플릭스'),
  t('2026-09-05', 17000, '문화/여가', sep05Memo),
  t('2026-06-20', 13000, '문화/여가', '기준a'),
  t('2026-07-20', 13000, '문화/여가', '기준b'),
  t('2026-08-20', 13000, '문화/여가', '기준c'),
  t('2026-09-06', 6000, '문화/여가', '영화'),
  t('2026-09-08', bookAmount, '문화/여가', '책'),
];

test('사례 9 (C70): 넷플릭스 제외, 비반복 2건 13,000 -> 예상 39,000 = 1.3배 경계 pace / 6,999원이면 없음', () => {
  const r = run(netflix());
  assert.equal(r.length, 1);
  assert.deepEqual(pick(r[0]), { level: 'pace', currentTotal: 30000, projectedTotal: 39000, ratio: 1.3 });
  assert.equal(r[0].baseline, 30000);
  assert.deepEqual(run(netflix('넷플릭스', 6999)), [], '예상 38,997');
});

test('C71a: 메모 앞뒤·연속 공백, 대소문자가 달라도 같은 그룹으로 제외', () => {
  const r = run(netflix(' 넷플릭스  '));
  assert.equal(r.length, 1);
  assert.equal(r[0].projectedTotal, 39000);
  const en = (memo) => netflix().map((x) => (x.memo === '넷플릭스' ? { ...x, memo: 'Net  Flix' } : x)).map((x) => (x.date === '2026-09-05' ? { ...x, memo } : x));
  assert.equal(run(en('  net flix '))[0].projectedTotal, 39000, '정규화 키 일치 -> 제외');
  assert.equal(run(en('netflix'))[0].projectedTotal, 90000, '다른 메모 -> 반복 아님, 3건 30,000 외삽');
});

test('사례 11 (C68): 주간 반복(필라테스) -> 항목 없음, recurring 에 weekly', () => {
  const txs = [];
  for (let d = '2026-06-04'; d <= '2026-09-10'; d = addDays(d, 7)) txs.push(t(d, 20000, '의료/건강', '필라테스'));
  assert.equal(txs.length, 15);
  assert.deepEqual(run(txs), []);
  assert.ok(hasRec(txs, '필라테스', 'weekly'));
});

test('C71b: 메모 없는 반복 그룹 (type, category, amount) 도 제외', () => {
  const txs = [
    ...['2026-06-02', '2026-07-02', '2026-08-02', '2026-09-02'].map((d) => t(d, 55000, '주거/통신')),
    t('2026-09-04', 3000, '주거/통신'),
    t('2026-09-08', 4000, '주거/통신'),
  ];
  const rec = detectRecurring(txs, SEP.today);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].amount, 55000);
  assert.equal(rec[0].period, 'monthly');
  assert.deepEqual(run(txs), []);
  // 제외하지 않았다면(빈 키) 예상 186,000 으로 pace 가 나오는 데이터
  const noKeys = detectOverspending(txs, SEP.month, SEP.today, new Set());
  assert.equal(noKeys.length, 1);
  assert.equal(noKeys[0].projectedTotal, 186000);
});

test('반복 키 Set 을 명시로 넘기든 생략하든 결과가 같다', () => {
  const txs = netflix();
  const keys = new Set(detectRecurringGroups(txs, SEP.today).map((g) => g.key));
  assert.deepEqual(detectOverspending(txs, SEP.month, SEP.today, keys), run(txs));
});

test('R4-Q4: 오늘 이후 날짜의 이번 달 거래도 currentTotal 과 pace 대상에 포함된다', () => {
  const txs = [...base('식비'), t('2026-09-02', 20000, '식비', '점심'), t('2026-09-05', 24000, '식비', '저녁'), t('2026-09-25', 50000, '식비', '미리 입력')];
  const r = run(txs);
  assert.deepEqual(pick(r[0]), { level: 'pace', currentTotal: 94000, projectedTotal: 282000, ratio: 2.82 });
});
