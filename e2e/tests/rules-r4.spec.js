// plan v2.1 R4 (과소비): C22~C24, C68~C71 + 관찰사항(O-R4-Q4). docs/plan.md 6장 "R4 경계 사례" 표의 사례 번호를 그대로 쓴다.
// 공통: month=2026-09 (30일), today=2026-09-10 (경과일 10), baseline 달 = 2026-06~08.
// 사례마다 새 사용자. 비반복 거래는 서로 다른 메모(R3 미감지). 데이터는 병렬 POST 로 만든다.
import { test, expect } from '@playwright/test';
import { get, addTx, createLoggedInUser } from '../helpers/api.js';

const MONTH = '2026-09';
const TODAY = '2026-09-10';
const BASE_MONTHS = ['2026-06', '2026-07', '2026-08'];

const insights = async (api, month = MONTH, today = TODAY) => (await get(api, `/api/insights?month=${month}&today=${today}`)).json();
const over = (ins, category) => ins.overspending.find((o) => o.category === category);

/** 새 사용자를 만들고 거래 목록을 모두 등록. t = {category, amount, memo, date} */
async function scenario(tag, txs) {
  const u = await createLoggedInUser(tag);
  const res = await Promise.all(txs.map((t) => addTx(u.api, t)));
  for (const r of res) expect(r.status(), await r.text()).toBe(201);
  return u.api;
}
/** baseline 달마다 서로 다른 메모의 비반복 거래 1건 */
const baseNonRecurring = (category, amount, prefix, day = 10) =>
  BASE_MONTHS.map((m, i) => ({ category, amount, memo: `${prefix}${i + 1}`, date: `${m}-${String(day).padStart(2, '0')}` }));
/** 월세(주거/통신) 사례 1 기본 데이터 */
const rent = (sep01 = 500000) => [
  { category: '주거/통신', amount: 500000, memo: '월세', date: '2026-06-01' },
  { category: '주거/통신', amount: 500000, memo: '월세', date: '2026-07-01' },
  { category: '주거/통신', amount: 500000, memo: '월세', date: '2026-08-01' },
  { category: '주거/통신', amount: sep01, memo: '월세', date: '2026-09-01' },
];
/** 사례 9 기본 데이터: 문화/여가, 넷플릭스 반복 + 비반복 baseline */
const netflix = (memo = '넷플릭스') => [
  ...['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05'].map((date) => ({ category: '문화/여가', amount: 17000, memo, date })),
  ...baseNonRecurring('문화/여가', 13000, '기준문화', 20),
  { category: '문화/여가', amount: 6000, memo: '영화', date: '2026-09-06' },
  { category: '문화/여가', amount: 7000, memo: '책', date: '2026-09-08' },
];

test.describe('C22 R4 exceeded (v2.1)', () => {
  const baseline = (amt = 100000) => [
    ...['2026-07', '2026-08', '2026-09'].map((m, i) => ({ category: '식비', amount: amt, memo: `기준식비${i + 1}`, date: `${m}-10` })),
  ];
  test('C22 직전 3개월 100,000 / 이번 달 120,000 -> exceeded, 119,999 -> 아님', async () => {
    const a = await scenario('c22a', [...baseline(), { category: '식비', amount: 120000, memo: '외식', date: '2026-10-05' }]);
    expect(over(await insights(a, '2026-10', '2026-10-19'), '식비')).toMatchObject({ level: 'exceeded', currentTotal: 120000, baseline: 100000, projectedTotal: null, ratio: 1.2 });
    const b = await scenario('c22b', [...baseline(), { category: '식비', amount: 119999, memo: '외식', date: '2026-10-05' }]);
    // today=10-19(경과 19일): 119,999 는 exceeded 아님. 비반복 1건이라 pace 도 안 됨(2건 기준)
    expect(over(await insights(b, '2026-10', '2026-10-19'), '식비')).toBeUndefined();
  });
  test('C22 사례 3: 월세 + 비반복 입주 청소 -> exceeded, currentTotal 600,000(반복 포함), ratio 1.2', async () => {
    const api = await scenario('c22s3', [...rent(), { category: '주거/통신', amount: 100000, memo: '입주 청소', date: '2026-09-05' }]);
    const ins = await insights(api);
    expect(over(ins, '주거/통신')).toMatchObject({ level: 'exceeded', currentTotal: 600000, baseline: 500000, projectedTotal: null, ratio: 1.2 });
    expect(ins.recurring.map((r) => r.memo)).toContain('월세');
  });
  test('C22 사례 10: 09-01 월세만 600,000(+20%) -> 그룹 전체 미감지, exceeded ratio 1.2', async () => {
    const api = await scenario('c22s10', rent(600000));
    const ins = await insights(api);
    expect(over(ins, '주거/통신')).toMatchObject({ level: 'exceeded', currentTotal: 600000, ratio: 1.2 });
    expect(ins.recurring.map((r) => r.memo)).not.toContain('월세'); // 중앙값 500,000 의 +20% -> 금액 조건 이탈
  });
});

test.describe('C23 R4 pace (v2.1: 비반복 2건 이상)', () => {
  const mk = (tag, a1, a2) => scenario(tag, [
    ...baseNonRecurring('식비', 100000, '기준식비'),
    { category: '식비', amount: a1, memo: '점심A', date: '2026-09-02' },
    { category: '식비', amount: a2, memo: '저녁B', date: '2026-09-05' },
  ]);
  test('C23 비반복 2건 합계 44,000 -> pace(projected 132,000 ratio 1.32)', async () => {
    const api = await mk('c23a', 20000, 24000);
    expect(over(await insights(api), '식비')).toMatchObject({ level: 'pace', currentTotal: 44000, baseline: 100000, projectedTotal: 132000, ratio: 1.32 });
  });
  test('C23 합계 43,334 -> pace(130,002, ratio 1.3), 43,333 -> 항목 없음 (경계)', async () => {
    const b = await mk('c23b', 20000, 23334);
    expect(over(await insights(b), '식비')).toMatchObject({ level: 'pace', projectedTotal: 130002, ratio: 1.3 });
    const c = await mk('c23c', 20000, 23333);
    expect(over(await insights(c), '식비')).toBeUndefined();
  });
  test('C23 44,000 데이터를 today=2026-09-06 으로 조회 -> 판정 안 함(경과일 6)', async () => {
    const api = await mk('c23d', 20000, 24000);
    expect(over(await insights(api, MONTH, '2026-09-06'), '식비')).toBeUndefined();
  });
  test('C23(31일 달) 2026-10 today=10-10: 비반복 2건 44,000 -> pace projected 136,400, 6일째는 판정 안 함', async () => {
    const api = await scenario('c23e', [
      ...['2026-07', '2026-08', '2026-09'].map((m, i) => ({ category: '식비', amount: 100000, memo: `기준식비${i + 1}`, date: `${m}-10` })),
      { category: '식비', amount: 20000, memo: '점심A', date: '2026-10-02' },
      { category: '식비', amount: 24000, memo: '저녁B', date: '2026-10-03' },
    ]);
    expect(over(await insights(api, '2026-10', '2026-10-10'), '식비')).toMatchObject({ level: 'pace', projectedTotal: 136400, ratio: 1.36 });
    expect(over(await insights(api, '2026-10', '2026-10-06'), '식비')).toBeUndefined();
  });
});

test.describe('C24 R4 제외 조건', () => {
  test('C24 1개월만 기록 -> 판정 안 함', async () => {
    const api = await scenario('c24a', [
      { category: '식비', amount: 100000, memo: '기준', date: '2026-08-10' },
      { category: '식비', amount: 50000, memo: '외식1', date: '2026-09-02' },
      { category: '식비', amount: 500000, memo: '외식2', date: '2026-09-05' },
    ]);
    expect(over(await insights(api), '식비')).toBeUndefined();
  });
  test('C24 baseline 9,999 -> exceeded/pace 모두 판정 안 함 (10,000 은 판정)', async () => {
    const data = (amt) => [
      ...baseNonRecurring('식비', amt, '기준식비'),
      { category: '식비', amount: 100000, memo: '외식1', date: '2026-09-02' },
      { category: '식비', amount: 100000, memo: '외식2', date: '2026-09-05' },
    ];
    expect(over(await insights(await scenario('c24b', data(9999))), '식비')).toBeUndefined();
    expect(over(await insights(await scenario('c24c', data(10000))), '식비')).toMatchObject({ level: 'exceeded' }); // 대조: 10,000 이면 판정
  });
  test('C24 C23 데이터를 month=2026-08, today=2026-09-10 으로 조회 -> pace 항목 없음(과거 달)', async () => {
    const api = await scenario('c24d', [
      ...baseNonRecurring('식비', 100000, '기준식비'),
      { category: '식비', amount: 20000, memo: '점심A', date: '2026-09-02' },
      { category: '식비', amount: 24000, memo: '저녁B', date: '2026-09-05' },
    ]);
    const ins = await insights(api, '2026-08', TODAY);
    expect(ins.overspending.filter((o) => o.level === 'pace')).toEqual([]);
    // 대조: 같은 데이터를 09 월로 조회하면 pace
    expect(over(await insights(api), '식비')).toMatchObject({ level: 'pace' });
  });
});

test.describe('C68 R4 pace 반복 제외', () => {
  test('C68 사례 1: 월세 1건만 -> 항목 없음, recurring 에 월세(monthly)', async () => {
    const ins = await insights(await scenario('c68s1', rent()));
    expect(over(ins, '주거/통신')).toBeUndefined();
    expect(ins.recurring.find((r) => r.memo === '월세')).toMatchObject({ period: 'monthly', amount: 500000, occurrences: 4 });
  });
  test('C68 사례 2: 월세 + 소액 비반복 2건(8,000) -> 항목 없음', async () => {
    const ins = await insights(await scenario('c68s2', [
      ...rent(),
      { category: '주거/통신', amount: 3000, memo: '전구', date: '2026-09-03' },
      { category: '주거/통신', amount: 5000, memo: '건전지', date: '2026-09-08' },
    ]));
    expect(over(ins, '주거/통신')).toBeUndefined();
    expect(ins.recurring.map((r) => r.memo)).toContain('월세');
  });
  test('C68 사례 11: 의료/건강 필라테스 주간 15건 -> 항목 없음, recurring 에 필라테스(weekly)', async () => {
    const txs = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(Date.UTC(2026, 5, 4 + 7 * i)); // 2026-06-04(목)부터 매주
      txs.push({ category: '의료/건강', amount: 20000, memo: '필라테스', date: d.toISOString().slice(0, 10) });
    }
    expect(txs[14].date).toBe('2026-09-10');
    const ins = await insights(await scenario('c68s11', txs));
    expect(over(ins, '의료/건강')).toBeUndefined();
    expect(ins.recurring.find((r) => r.memo === '필라테스')).toMatchObject({ period: 'weekly', occurrences: 15 });
  });
});

test.describe('C69 R4 pace 2건 기준', () => {
  const shopping = () => baseNonRecurring('쇼핑', 100000, '기준쇼핑');
  test('C69 사례 4: 큰 단건 1건(패딩 90,000) -> 항목 없음', async () => {
    const api = await scenario('c69s4', [...shopping(), { category: '쇼핑', amount: 90000, memo: '패딩', date: '2026-09-05' }]);
    expect(over(await insights(api), '쇼핑')).toBeUndefined();
  });
  test('C69 사례 5: 큰 단건 + 소액 1건 -> pace, currentTotal 95,000, projected 285,000, ratio 2.85', async () => {
    const api = await scenario('c69s5', [
      ...shopping(),
      { category: '쇼핑', amount: 90000, memo: '패딩', date: '2026-09-05' },
      { category: '쇼핑', amount: 5000, memo: '양말', date: '2026-09-07' },
    ]);
    expect(over(await insights(api), '쇼핑')).toMatchObject({ level: 'pace', currentTotal: 95000, baseline: 100000, projectedTotal: 285000, ratio: 2.85 });
  });
  test('C69 식비 baseline 100,000 에서 09-05 비반복 44,000 1건만 -> 항목 없음', async () => {
    const api = await scenario('c69x', [...baseNonRecurring('식비', 100000, '기준식비'), { category: '식비', amount: 44000, memo: '회식', date: '2026-09-05' }]);
    expect(over(await insights(api), '식비')).toBeUndefined();
  });
});

test.describe('C70 R4 pace R3 경계', () => {
  const culture = () => [
    { category: '문화/여가', amount: 30000, memo: '콘서트', date: '2026-06-12' },
    { category: '문화/여가', amount: 30000, memo: '전시회', date: '2026-07-20' },
    { category: '문화/여가', amount: 14900, memo: '유튜브 프리미엄', date: '2026-08-03' },
    { category: '문화/여가', amount: 15100, memo: '영화', date: '2026-08-10' },
    { category: '문화/여가', amount: 14900, memo: '유튜브 프리미엄', date: '2026-09-03' },
  ];
  test('C70 사례 6: 신규 구독 2건(미감지) -> 항목 없음, recurring 에 유튜브 프리미엄 없음', async () => {
    const ins = await insights(await scenario('c70s6', culture()));
    expect(over(ins, '문화/여가')).toBeUndefined();
    expect(ins.recurring.map((r) => r.memo)).not.toContain('유튜브 프리미엄');
  });
  test('C70 사례 7: 사례 6 + 09-06 영화 15,000 -> pace, projected 89,700, ratio 2.99, currentTotal 29,900', async () => {
    const api = await scenario('c70s7', [...culture(), { category: '문화/여가', amount: 15000, memo: '영화', date: '2026-09-06' }]);
    expect(over(await insights(api), '문화/여가')).toMatchObject({ level: 'pace', currentTotal: 29900, baseline: 30000, projectedTotal: 89700, ratio: 2.99 });
  });
  test('C70 사례 8: 사례 7 데이터를 today=2026-09-06 으로 조회 -> 항목 없음(경과일 6)', async () => {
    const api = await scenario('c70s8', [...culture(), { category: '문화/여가', amount: 15000, memo: '영화', date: '2026-09-06' }]);
    expect(over(await insights(api, MONTH, '2026-09-06'), '문화/여가')).toBeUndefined();
  });
  test('C70 사례 9: 넷플릭스 제외 후 비반복 2건 13,000 -> pace, currentTotal 30,000, projected 39,000 = baseline x 1.3, ratio 1.3', async () => {
    const ins = await insights(await scenario('c70s9', netflix()));
    expect(over(ins, '문화/여가')).toMatchObject({ level: 'pace', currentTotal: 30000, baseline: 30000, projectedTotal: 39000, ratio: 1.3 });
    expect(ins.recurring.find((r) => r.memo === '넷플릭스')).toMatchObject({ period: 'monthly' });
  });
  test('C70 사례 9 변형: "책" 6,999원 -> 예상 38,997 -> 항목 없음', async () => {
    const txs = netflix().map((t) => (t.memo === '책' ? { ...t, amount: 6999 } : t));
    expect(over(await insights(await scenario('c70s9b', txs)), '문화/여가')).toBeUndefined();
  });
});

test.describe('C71 R4 pace 그룹 키 연결', () => {
  test('C71(a1) 09-05 메모를 " 넷플릭스  "(앞뒤 공백)로 기록해도 사례 9와 동일', async () => {
    const txs = netflix().map((t) => (t.memo === '넷플릭스' && t.date === '2026-09-05' ? { ...t, memo: ' 넷플릭스  ' } : t));
    const ins = await insights(await scenario('c71a1', txs));
    expect(over(ins, '문화/여가')).toMatchObject({ level: 'pace', projectedTotal: 39000, ratio: 1.3 });
    expect(ins.recurring.find((r) => r.memo.trim() === '넷플릭스')).toBeTruthy();
  });
  test('C71(a2) 대소문자·연속 공백 차이("Netflix"/"NETFLIX"/"netflix  ") 정규화 -> 사례 9와 동일', async () => {
    const memos = { '2026-06-05': 'Netflix', '2026-07-05': 'NETFLIX', '2026-08-05': 'netflix  ', '2026-09-05': ' NetFlix' };
    const txs = netflix().map((t) => (memos[t.date] && t.amount === 17000 ? { ...t, memo: memos[t.date] } : t));
    const ins = await insights(await scenario('c71a2', txs));
    expect(over(ins, '문화/여가')).toMatchObject({ level: 'pace', currentTotal: 30000, projectedTotal: 39000, ratio: 1.3 });
    expect(ins.recurring.filter((r) => r.memo.trim().toLowerCase() === 'netflix')).toHaveLength(1);
  });
  test('C71(a3) 내부 연속 공백 "Netflix  Premium" / "netflix premium" 도 같은 그룹', async () => {
    const memos = { '2026-06-05': 'Netflix  Premium', '2026-07-05': 'netflix premium', '2026-08-05': 'NETFLIX   PREMIUM', '2026-09-05': 'Netflix Premium' };
    const txs = netflix().map((t) => (memos[t.date] && t.amount === 17000 ? { ...t, memo: memos[t.date] } : t));
    const ins = await insights(await scenario('c71a3', txs));
    expect(over(ins, '문화/여가')).toMatchObject({ level: 'pace', projectedTotal: 39000 });
  });
  test('C71(b) 메모 없는 반복(55,000 x4) + 메모 없는 3,000/4,000 -> recurring 에 주거/통신 55,000 monthly, overspending 항목 없음', async () => {
    const mkTx = (amount, date) => ({ category: '주거/통신', amount, memo: '', date });
    const ins = await insights(await scenario('c71b', [
      mkTx(55000, '2026-06-02'), mkTx(55000, '2026-07-02'), mkTx(55000, '2026-08-02'), mkTx(55000, '2026-09-02'),
      mkTx(3000, '2026-09-04'), mkTx(4000, '2026-09-08'),
    ]));
    expect(ins.recurring.find((r) => r.category === '주거/통신' && r.amount === 55000)).toMatchObject({ period: 'monthly', occurrences: 4 });
    expect(over(ins, '주거/통신')).toBeUndefined();
  });
  test('C71(대조) 같은 메모 반복이 다른 카테고리로 기록된 이번 달 건도 pace 대상에서 제외된다(plan 6장 R4-P 2)', async () => {
    // 넷플릭스 06~08 은 문화/여가, 09-05 만 기타로 기록 + 문화/여가 비반복 2건. 키(메모)가 같으므로 기타의 넷플릭스도 제외되어야 한다.
    const txs = netflix().map((t) => (t.memo === '넷플릭스' && t.date === '2026-09-05' ? { ...t, category: '기타' } : t));
    const ins = await insights(await scenario('c71c', txs));
    expect(over(ins, '기타')).toBeUndefined(); // 기타 baseline 없음 -> 판정 안 함(그리고 반복이라 pace 대상 아님)
    expect(ins.recurring.find((r) => r.memo === '넷플릭스')).toMatchObject({ period: 'monthly', occurrences: 4 });
  });
});

test.describe('B4 미래 날짜 지출은 진행 중인 달의 R4 에서 제외 (api.md v4.3, 옛 관찰사항 O-R4-Q4 갱신)', () => {
  test('O-R4-Q4 오늘(09-10) 이후 날짜로 미리 입력한 이번 달 지출은 currentTotal/exceeded 에서 빠진다 -> R4 항목 없음', async () => {
    const api = await scenario('oq4', [
      ...baseNonRecurring('식비', 100000, '기준식비'),
      { category: '식비', amount: 130000, memo: '미리입력', date: '2026-09-25' }, // today(09-10) 이후
    ]);
    const ins = await insights(api, MONTH, TODAY);
    expect(over(ins, '식비'), JSON.stringify(ins.overspending)).toBeUndefined();
  });
  test('B4 오늘 날짜 지출은 포함된다: 09-10 130,000 -> exceeded currentTotal 130000', async () => {
    const api = await scenario('oq4today', [
      ...baseNonRecurring('식비', 100000, '기준식비'),
      { category: '식비', amount: 130000, memo: '오늘지출', date: TODAY },
    ]);
    expect(over(await insights(api, MONTH, TODAY), '식비')).toMatchObject({ level: 'exceeded', currentTotal: 130000 });
  });
  test('B4 오늘 이전 지출 + 미래 지출 혼합: 미래 건만 빠진다 (09-05 120,000 + 09-25 50,000 -> currentTotal 120000)', async () => {
    const api = await scenario('oq4mix', [
      ...baseNonRecurring('식비', 100000, '기준식비'),
      { category: '식비', amount: 120000, memo: '지난지출', date: '2026-09-05' },
      { category: '식비', amount: 50000, memo: '미리입력', date: '2026-09-25' },
    ]);
    expect(over(await insights(api, MONTH, TODAY), '식비')).toMatchObject({ level: 'exceeded', currentTotal: 120000 });
  });
  test('B4 지난달·다음 달 조회는 그대로: 과거 달의 지출은 날짜와 상관없이 전부, 미래 달은 today 보다 뒤여도 그대로 (조회 달이 today 의 달일 때만 제외)', async () => {
    const api = await scenario('oq4past', [
      ...baseNonRecurring('식비', 100000, '기준식비'),
      { category: '식비', amount: 130000, memo: '말일지출', date: '2026-09-28' },
    ]);
    // today 가 10월이면 9월은 끝난 달: 09-28 지출이 today 보다 앞이므로 그대로 포함
    expect(over(await insights(api, MONTH, '2026-10-05'), '식비')).toMatchObject({ level: 'exceeded', currentTotal: 130000 });
    // today 가 8월이면 9월은 미래 달: 미래 달 조회는 날짜 제외 규칙이 없다(조회 달이 today 의 달이 아님)
    const fut = over(await insights(api, MONTH, '2026-08-20'), '식비');
    test.info().annotations.push({ type: 'observation', description: 'today=08-20, month=09(미래 달): ' + JSON.stringify(fut) });
  });
  test('B4 pace: 미래 지출 2건은 pace 대상 건수·합계에서도 빠진다 (경과일 10, 비반복 1건 + 미래 1건 -> pace 안 됨)', async () => {
    const api = await scenario('oq4pace', [
      ...baseNonRecurring('식비', 100000, '기준식비'),
      { category: '식비', amount: 90000, memo: '이번지출', date: '2026-09-08' },
      { category: '식비', amount: 90000, memo: '미리입력', date: '2026-09-28' },
    ]);
    expect(over(await insights(api, MONTH, TODAY), '식비'), 'pace 대상 1건이라 항목 없음').toBeUndefined();
  });
});
