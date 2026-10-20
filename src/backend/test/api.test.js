import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';
import { buildSeedTransactions } from '../scripts/seed.js';

let app;
before(async () => {
  app = await startApp({}, { now: () => new Date('2026-10-18T16:00:00Z') }); // KST 2026-10-19 01:00
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from transactions; delete from auth_attempts; delete from sessions; delete from users;');
});

async function newUser(email) {
  const r = await app.request('POST', '/api/auth/signup', { body: { email, password: GOOD_PASSWORD } });
  assert.equal(r.status, 201);
  return { cookie: cookieFrom(r), id: r.json.user.id };
}
const A = () => newUser('a@example.com');
const B = () => newUser('b@example.com');
const valid = (o = {}) => ({ type: 'expense', amount: 4500, category: '카페/간식', memo: '스타벅스', date: '2026-10-19', ...o });
const post = (u, body, extra = {}) => app.request('POST', '/api/transactions', { body, cookie: u.cookie, ...extra });
const get = (u, path) => app.request('GET', path, { cookie: u.cookie });

test('C6 POST 201, id/createdAt 포함 userId 미포함, 목록에 나타남, 카테고리 API', async () => {
  const u = await A();
  const r = await post(u, valid());
  assert.equal(r.status, 201);
  assert.match(r.json.id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(r.json.createdAt)));
  assert.ok(!('userId' in r.json) && !('user_id' in r.json));
  assert.deepEqual(Object.keys(r.json).sort(), ['amount', 'category', 'createdAt', 'date', 'id', 'memo', 'type']);
  const list = await get(u, '/api/transactions?month=2026-10');
  assert.equal(list.json.month, '2026-10');
  assert.deepEqual(list.json.transactions.map((t) => t.id), [r.json.id]);
  const cats = await get(u, '/api/categories');
  assert.equal(cats.json.expense[0], '식비');
  assert.equal(cats.json.income.length, 4);
});

test('C7 잘못된 입력은 400 VALIDATION_ERROR + 에러 형식', async () => {
  const u = await A();
  const cases = [
    { amount: 0 }, { amount: -5 }, { amount: 1.5 }, { amount: '4500' }, { amount: 100_000_001 }, { amount: null }, { amount: undefined },
    { type: undefined }, { type: 'transfer' },
    { type: 'income', category: '식비' }, { category: undefined }, { category: '없는카테고리' },
    { date: '2026-02-30' }, { date: '2026-13-01' }, { date: '20261019' }, { date: undefined }, { date: '2026-1-5' },
    { memo: 'a'.repeat(51) }, { memo: 123 },
  ];
  for (const c of cases) {
    const r = await post(u, valid(c));
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR', JSON.stringify(c));
    assert.equal(typeof r.json.error.message, 'string');
  }
  const bad = await app.request('POST', '/api/transactions', { raw: '{"type":', cookie: u.cookie });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_JSON');
  assert.equal((await get(u, '/api/transactions?month=2026-10')).json.transactions.length, 0);
});

test('C8 경계값: amount 1, 100,000,000, memo 50자는 201; 메모 공백 제거', async () => {
  const u = await A();
  assert.equal((await post(u, valid({ amount: 1 }))).status, 201);
  assert.equal((await post(u, valid({ amount: 100_000_000 }))).status, 201);
  assert.equal((await post(u, valid({ memo: 'a'.repeat(50) }))).status, 201);
  assert.equal((await post(u, valid({ memo: '가'.repeat(50) }))).status, 201);
  const r = await post(u, valid({ memo: '  공백  ' }));
  assert.equal(r.json.memo, '공백');
  const noMemo = await post(u, { type: 'income', amount: 10, category: '급여', date: '2026-10-01' });
  assert.equal(noMemo.status, 201);
  assert.equal(noMemo.json.memo, '');
});

test('C9/C10 PUT 반영, 없는 id·UUID 아닌 id 404, DELETE 204 후 사라짐', async () => {
  const u = await A();
  const t = (await post(u, valid())).json;
  const put = await app.request('PUT', `/api/transactions/${t.id}`, { cookie: u.cookie, body: valid({ amount: 9000, memo: '수정', date: '2026-10-20' }) });
  assert.equal(put.status, 200);
  assert.equal(put.json.amount, 9000);
  assert.equal(put.json.createdAt, t.createdAt);
  const list = await get(u, '/api/transactions?month=2026-10');
  assert.equal(list.json.transactions[0].memo, '수정');
  const bad = await app.request('PUT', `/api/transactions/${t.id}`, { cookie: u.cookie, body: valid({ amount: 0 }) });
  assert.equal(bad.status, 400);
  const ghost = '00000000-0000-4000-8000-000000000000';
  for (const id of [ghost, 'abc', '123', "1'; drop table transactions;--"]) {
    for (const m of ['PUT', 'DELETE']) {
      const r = await app.request(m, `/api/transactions/${encodeURIComponent(id)}`, { cookie: u.cookie, body: m === 'PUT' ? valid() : undefined });
      assert.equal(r.status, 404, `${m} ${id}`);
      assert.equal(r.json.error.code, 'NOT_FOUND');
    }
  }
  const del = await app.request('DELETE', `/api/transactions/${t.id}`, { cookie: u.cookie });
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
  assert.equal((await get(u, '/api/transactions?month=2026-10')).json.transactions.length, 0);
  assert.equal((await app.request('DELETE', `/api/transactions/${t.id}`, { cookie: u.cookie })).status, 404);
});

test('목록: month 검증, 정렬(date 내림차순, 같은 날 createdAt 내림차순)', async () => {
  const u = await A();
  for (const m of [undefined, '2026-1', '2026-13', 'abc']) {
    const r = await get(u, `/api/transactions${m === undefined ? '' : `?month=${m}`}`);
    assert.equal(r.status, 400, String(m));
  }
  const a = (await post(u, valid({ memo: 'a', date: '2026-10-05' }))).json;
  const b = (await post(u, valid({ memo: 'b', date: '2026-10-05' }))).json;
  const c = (await post(u, valid({ memo: 'c', date: '2026-10-09' }))).json;
  const list = (await get(u, '/api/transactions?month=2026-10')).json.transactions;
  assert.deepEqual(list.map((t) => t.id), [c.id, b.id, a.id]);
});

test('C12 병렬 20건 모두 201', async () => {
  const u = await A();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post(u, valid({ amount: 100 + i }))));
  assert.ok(rs.every((r) => r.status === 201));
  assert.equal((await get(u, '/api/transactions?month=2026-10')).json.transactions.length, 20);
});

test('C47 SQL/HTML 메모 그대로 저장, autocomplete q="\'" 에 500 없음', async () => {
  const u = await A();
  const memos = ["' OR 1=1 --", '<img src=x onerror=alert(1)>'];
  for (const memo of memos) assert.equal((await post(u, valid({ memo }))).status, 201);
  const list = (await get(u, '/api/transactions?month=2026-10')).json.transactions;
  assert.deepEqual(list.map((t) => t.memo).sort(), [...memos].sort());
  const r = await get(u, `/api/recommendations/autocomplete?q=${encodeURIComponent("'")}&type=expense`);
  assert.equal(r.status, 200);
  assert.equal((await get(u, `/api/recommendations/autocomplete?q=${encodeURIComponent('<img')}`)).json.items[0].memo, memos[1]);
});

test('C49 타 사용자 거래: 목록 비노출, PUT/DELETE 404 이고 원본 불변', async () => {
  const a = await A();
  const b = await B();
  const t = (await post(a, valid())).json;
  assert.equal((await get(b, '/api/transactions?month=2026-10')).json.transactions.length, 0);
  const put = await app.request('PUT', `/api/transactions/${t.id}`, { cookie: b.cookie, body: valid({ amount: 1 }) });
  assert.equal(put.status, 404);
  assert.equal((await app.request('DELETE', `/api/transactions/${t.id}`, { cookie: b.cookie })).status, 404);
  const after = (await get(a, '/api/transactions?month=2026-10')).json.transactions;
  assert.equal(after.length, 1);
  assert.equal(after[0].amount, 4500);
});

test('C50 본문의 userId/user_id 는 무시되고 세션 사용자 소유로 저장', async () => {
  const a = await A();
  const b = await B();
  const r = await post(b, { ...valid(), userId: a.id, user_id: a.id, id: '11111111-1111-4111-8111-111111111111', createdAt: '2000-01-01T00:00:00Z' });
  assert.equal(r.status, 201);
  assert.notEqual(r.json.id, '11111111-1111-4111-8111-111111111111');
  assert.notEqual(r.json.createdAt, '2000-01-01T00:00:00.000Z');
  assert.equal((await get(a, '/api/transactions?month=2026-10')).json.transactions.length, 0);
  assert.equal((await get(b, '/api/transactions?month=2026-10')).json.transactions.length, 1);
  const { rows } = await app.db.query('select user_id from transactions where id = $1', [r.json.id]);
  assert.equal(rows[0].user_id, b.id);
});

test('C13 summary: 합계/잔액/카테고리 비율, 빈 달은 0', async () => {
  const u = await A();
  await post(u, valid({ amount: 3000, category: '식비' }));
  await post(u, valid({ amount: 1000, category: '식비' }));
  await post(u, valid({ amount: 1000, category: '교통' }));
  await post(u, valid({ amount: 1000, category: '쇼핑' }));
  await post(u, { type: 'income', amount: 10000, category: '급여', date: '2026-10-01' });
  const s = (await get(u, '/api/summary?month=2026-10')).json;
  assert.equal(s.incomeTotal, 10000);
  assert.equal(s.expenseTotal, 6000);
  assert.equal(s.balance, 4000);
  assert.deepEqual(s.byCategory, [
    { category: '식비', total: 4000, count: 2, ratio: 0.6667 },
    { category: '교통', total: 1000, count: 1, ratio: 0.1667 },
    { category: '쇼핑', total: 1000, count: 1, ratio: 0.1667 },
  ]);
  assert.deepEqual((await get(u, '/api/summary?month=2026-09')).json, { month: '2026-09', incomeTotal: 0, expenseTotal: 0, balance: 0, byCategory: [] });
  assert.equal((await get(u, '/api/summary')).status, 400);
});

test('C56 월 경계: 09-30 과 10-01 이 각 월에 집계, date 밀림 없음', async () => {
  const u = await A();
  await post(u, valid({ amount: 100, date: '2026-09-30' }));
  await post(u, valid({ amount: 200, date: '2026-10-01' }));
  await post(u, valid({ amount: 400, date: '2026-10-31' }));
  await post(u, valid({ amount: 800, date: '2026-11-01' }));
  assert.equal((await get(u, '/api/summary?month=2026-09')).json.expenseTotal, 100);
  assert.equal((await get(u, '/api/summary?month=2026-10')).json.expenseTotal, 600);
  const sep = (await get(u, '/api/transactions?month=2026-09')).json.transactions;
  assert.equal(sep[0].date, '2026-09-30');
  const oct = (await get(u, '/api/transactions?month=2026-10')).json.transactions;
  assert.deepEqual(oct.map((t) => t.date), ['2026-10-31', '2026-10-01']);
  const m = (await get(u, '/api/stats/monthly?from=2026-09&to=2026-11')).json.months;
  assert.deepEqual(m.map((x) => x.expenseTotal), [100, 600, 800]);
  const cm = (await get(u, '/api/stats/category-monthly?from=2026-09&to=2026-11')).json;
  assert.deepEqual(cm.series[0].totals, [100, 600, 800]);
});

test('C52~C54 stats 3종: 빈 달 0, 정렬, ratio, 합계 일치', async () => {
  const u = await A();
  await post(u, valid({ amount: 1000, category: '식비', date: '2026-05-10' }));
  await post(u, valid({ amount: 1000, category: '교통', date: '2026-05-11' })); // 동률 -> 고정 순서
  await post(u, { type: 'income', amount: 5000, category: '급여', date: '2026-05-25' });
  await post(u, valid({ amount: 3000, category: '쇼핑', date: '2026-07-01' }));
  await post(u, valid({ amount: 7, category: '식비', date: '2026-07-31' }));
  const mo = (await get(u, '/api/stats/monthly?from=2026-05&to=2026-10')).json;
  assert.equal(mo.months.length, 6);
  assert.deepEqual(mo.months.map((m) => m.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(mo.months[0], { month: '2026-05', incomeTotal: 5000, expenseTotal: 2000, balance: 3000, count: 3 });
  assert.deepEqual(mo.months[1], { month: '2026-06', incomeTotal: 0, expenseTotal: 0, balance: 0, count: 0 });
  assert.equal(mo.months[2].expenseTotal, 3007);

  const cat = (await get(u, '/api/stats/categories?from=2026-05&to=2026-07')).json;
  assert.equal(cat.type, 'expense');
  assert.equal(cat.grandTotal, 5007);
  assert.deepEqual(cat.items.map((i) => i.category), ['쇼핑', '식비', '교통']);
  assert.equal(cat.items.reduce((s, i) => s + i.total, 0), cat.grandTotal);
  assert.equal(cat.items[0].ratio, Math.round((3000 / 5007) * 10000) / 10000);
  const tie = (await get(u, '/api/stats/categories?from=2026-05&to=2026-05')).json;
  assert.deepEqual(tie.items.map((i) => i.category), ['식비', '교통'], '동률은 고정 순서');
  const inc = (await get(u, '/api/stats/categories?from=2026-05&to=2026-05&type=income')).json;
  assert.deepEqual(inc.items, [{ category: '급여', total: 5000, count: 1, ratio: 1 }]);
  assert.deepEqual((await get(u, '/api/stats/categories?from=2026-08&to=2026-08')).json, { from: '2026-08', to: '2026-08', type: 'expense', grandTotal: 0, items: [] });

  const cm = (await get(u, '/api/stats/category-monthly?from=2026-05&to=2026-07')).json;
  assert.deepEqual(cm.months, ['2026-05', '2026-06', '2026-07']);
  for (const s of cm.series) {
    assert.equal(s.totals.length, 3);
    assert.equal(s.sum, s.totals.reduce((a, b) => a + b, 0));
  }
  assert.deepEqual(cm.series.map((s) => s.category), ['쇼핑', '식비', '교통']);
  const monthSum = cm.months.map((_, i) => cm.series.reduce((s, x) => s + x.totals[i], 0));
  assert.deepEqual(monthSum, mo.months.slice(0, 3).map((m) => m.expenseTotal));
});

test('C55 집계 검증: from>to, 25개월, 형식, 누락, type 오류는 400, 24개월은 200', async () => {
  const u = await A();
  const bad = [
    'from=2026-10&to=2026-09', 'from=2024-01&to=2026-01', 'from=2026-13&to=2026-13', 'from=2026-1&to=2026-10',
    'from=2026-01', 'to=2026-01', '', 'from=2026-01&to=2026-02&type=foo',
  ];
  for (const path of ['monthly', 'categories', 'category-monthly']) {
    for (const q of bad) {
      const r = await get(u, `/api/stats/${path}?${q}`);
      assert.equal(r.status, 400, `${path}?${q}`);
      assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    }
    assert.equal((await get(u, `/api/stats/${path}?from=2024-11&to=2026-10`)).status, 200);
  }
  assert.equal((await get(u, '/api/stats/monthly?from=2024-11&to=2026-10')).json.months.length, 24);
});

test('C43 인증 필요: 신규 엔드포인트 모두 쿠키 없이 401', async () => {
  const paths = [
    ['GET', '/api/categories'], ['POST', '/api/categories'], ['PATCH', '/api/categories/00000000-0000-4000-8000-000000000000'],
    ['GET', '/api/transactions?month=2026-10'], ['POST', '/api/transactions'],
    ['PUT', '/api/transactions/00000000-0000-4000-8000-000000000000'], ['DELETE', '/api/transactions/00000000-0000-4000-8000-000000000000'],
    ['GET', '/api/summary?month=2026-10'], ['GET', '/api/stats/monthly?from=2026-01&to=2026-02'],
    ['GET', '/api/stats/categories?from=2026-01&to=2026-02'], ['GET', '/api/stats/category-monthly?from=2026-01&to=2026-02'],
    ['GET', '/api/recommendations/quick'], ['GET', '/api/recommendations/autocomplete?q=a'], ['GET', '/api/insights?month=2026-10'],
  ];
  for (const [m, p] of paths) {
    const r = await app.request(m, p, { body: m === 'POST' || m === 'PUT' ? valid() : undefined });
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.equal(r.json.error.code, 'UNAUTHENTICATED');
  }
  const bogus = await app.request('GET', '/api/summary?month=2026-10', { cookie: 'mb_sid=nope' });
  assert.equal(bogus.status, 401);
});

test('추천 API 검증: type/today/q 오류는 400, today 기본값은 Asia/Seoul', async () => {
  const u = await A();
  for (const p of [
    '/api/recommendations/quick?type=foo', '/api/recommendations/quick?today=2026-02-30', '/api/recommendations/quick?today=20261019',
    '/api/recommendations/autocomplete?q=a&type=foo', `/api/recommendations/autocomplete?q=${'a'.repeat(51)}`,
    '/api/insights', '/api/insights?month=2026-13', '/api/insights?month=2026-10&today=abc',
  ]) {
    assert.equal((await get(u, p)).status, 400, p);
  }
  assert.deepEqual((await get(u, '/api/recommendations/autocomplete?q=')).json, { items: [] });
  assert.deepEqual((await get(u, '/api/recommendations/autocomplete')).json, { items: [] });
  // 서버 시각이 UTC 2026-10-18T16:00Z(KST 10-19) 일 때 today 생략 = 2026-10-19
  for (let i = 0; i < 3; i++) await post(u, valid({ memo: '커피', date: i === 0 ? '2026-10-19' : '2026-10-18' }));
  const q = (await get(u, '/api/recommendations/quick')).json.items;
  assert.equal(q.length, 1);
  assert.equal(q[0].lastDate, '2026-10-19');
  assert.equal((await get(u, '/api/recommendations/quick?today=2026-10-18')).json.items.length, 0, '미래 날짜 거래는 제외');
});

test('R1/R2 API: 형태와 필드', async () => {
  const u = await A();
  for (const d of ['2026-10-12', '2026-10-05', '2026-10-17']) await post(u, valid({ date: d }));
  const q = (await get(u, '/api/recommendations/quick?type=expense&today=2026-10-19')).json;
  assert.deepEqual(q.items, [{ memo: '스타벅스', category: '카페/간식', amount: 4500, count: 3, lastDate: '2026-10-17', weekdayMatch: true }]);
  const ac = (await get(u, `/api/recommendations/autocomplete?q=${encodeURIComponent('스타')}&type=expense&today=2026-10-19`)).json;
  assert.deepEqual(ac.items, [{ memo: '스타벅스', category: '카페/간식', amount: 4500 }]);
  assert.deepEqual((await get(u, '/api/recommendations/quick?type=income&today=2026-10-19')).json, { items: [] });
});

test('C26/C51 시드 데이터: 본인은 R1~R5 + 6개월 지출, 타 사용자는 모두 비어 있음', async () => {
  const a = await A();
  const b = await B();
  const today = '2026-10-19';
  for (const t of buildSeedTransactions(today)) {
    await app.db.query('insert into transactions (user_id, type, amount, category, memo, date) values ($1,$2,$3,$4,$5,$6::date)', [a.id, t.type, t.amount, t.category, t.memo, t.date]);
  }
  const ins = (await get(a, `/api/insights?month=2026-10&today=${today}`)).json;
  assert.ok(ins.recurring.length >= 1, 'R3');
  assert.ok(ins.overspending.length >= 1, 'R4');
  assert.ok(ins.largeExpenses.length >= 1, 'R5');
  assert.equal(ins.largeExpenses[0].memo, '패딩');
  assert.ok((await get(a, `/api/recommendations/quick?today=${today}`)).json.items.length >= 1, 'R1');
  const mo = (await get(a, '/api/stats/monthly?from=2026-05&to=2026-10')).json.months;
  assert.ok(mo.every((m) => m.expenseTotal > 0));

  // B 는 모두 비어 있음
  assert.deepEqual((await get(b, '/api/summary?month=2026-10')).json.byCategory, []);
  assert.ok((await get(b, '/api/stats/monthly?from=2026-05&to=2026-10')).json.months.every((m) => m.count === 0 && m.balance === 0));
  assert.equal((await get(b, '/api/stats/categories?from=2026-05&to=2026-10')).json.items.length, 0);
  assert.equal((await get(b, '/api/stats/category-monthly?from=2026-05&to=2026-10')).json.series.length, 0);
  assert.deepEqual((await get(b, `/api/recommendations/quick?today=${today}`)).json.items, []);
  assert.deepEqual((await get(b, `/api/recommendations/autocomplete?q=${encodeURIComponent('스타')}&today=${today}`)).json.items, []);
  const bi = (await get(b, `/api/insights?month=2026-10&today=${today}`)).json;
  assert.deepEqual([bi.recurring, bi.overspending, bi.largeExpenses], [[], [], []]);
});

test('시드 today 가 월 초/말이어도 R1~R5 가 모두 나온다', async () => {
  const { quickSuggestions } = await import('../rules/quick.js');
  const { detectRecurring } = await import('../rules/recurring.js');
  const { detectOverspending } = await import('../rules/overspending.js');
  const { detectLargeExpenses } = await import('../rules/large.js');
  for (const today of ['2026-10-01', '2026-10-04', '2026-10-05', '2026-10-31', '2026-03-01', '2026-02-28', '2027-01-02']) {
    const txs = buildSeedTransactions(today).map((t, i) => ({ ...t, id: `s${i}`, createdAt: '2026-01-01T00:00:00Z' }));
    const month = today.slice(0, 7);
    assert.ok(quickSuggestions(txs, 'expense', today).length >= 1, `R1 ${today}`);
    assert.ok(detectRecurring(txs, today).length >= 1, `R3 ${today}`);
    assert.ok(detectOverspending(txs, month, today).some((x) => x.level === 'exceeded'), `R4 ${today}`);
    assert.ok(detectLargeExpenses(txs, month).length >= 1, `R5 ${today}`);
  }
});

test('내부 오류는 500 INTERNAL_ERROR 이고 SQL/스택을 노출하지 않는다 (C48)', async () => {
  const u = await A();
  await app.db.exec('alter table transactions rename to transactions_x');
  try {
    const r = await get(u, '/api/transactions?month=2026-10');
    assert.equal(r.status, 500);
    assert.equal(r.json.error.code, 'INTERNAL_ERROR');
    assert.ok(!/transactions|select|at \w/i.test(r.text));
  } finally {
    await app.db.exec('alter table transactions_x rename to transactions');
  }
});
