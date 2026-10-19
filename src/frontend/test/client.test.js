// API 클라이언트, 문구, 대시보드 어댑터, 인사이트 문장, 디바운스 단위 테스트 (목업 fetch / 가짜 타이머)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, parseRetryAfter, buildQuery } from '../public/js/api.js';
import { authErrorMessage, waitText } from '../public/js/lib/messages.js';
import {
  buildKpi, expenseChange, donutItemsFrom, trendCategories, defaultTrendCategory, seriesFor,
} from '../public/js/lib/dashboard-data.js';
import { buildInsightSections, overspendingLine, recurringLine, largeExpenseLine } from '../public/js/lib/insight-text.js';
import { debounce } from '../public/js/lib/debounce.js';

function mockFetch(status, body, headers = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      status, ok: status >= 200 && status < 300,
      headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
      json: async () => { if (body === undefined) throw new Error('no body'); return body; },
    };
  };
  fn.calls = calls;
  return fn;
}

test('api: GET 은 same-origin 쿠키, 쿼리 인코딩, Content-Type 없음', async () => {
  const f = mockFetch(200, { items: [] });
  const api = createApi({ fetchImpl: f });
  await api.autocomplete('스타 벅스', 'expense', '2026-10-19');
  const c = f.calls[0];
  assert.equal(c.init.credentials, 'same-origin');
  assert.equal(c.init.method, 'GET');
  assert.equal(c.init.headers['Content-Type'], undefined);
  assert.match(c.url, /^\/api\/recommendations\/autocomplete\?q=/);
  assert.equal(new URL(c.url, 'http://x').searchParams.get('q'), '스타 벅스');
});

test('api: POST 는 JSON Content-Type 과 본문, 204 는 null', async () => {
  const f = mockFetch(204);
  const api = createApi({ fetchImpl: f });
  const r = await api.logout();
  assert.equal(r, null);
  const f2 = mockFetch(201, { id: 'x' });
  const api2 = createApi({ fetchImpl: f2 });
  await api2.createTransaction({ type: 'expense', amount: 1 });
  assert.equal(f2.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(f2.calls[0].init.body), { type: 'expense', amount: 1 });
});

test('api: 에러 메시지/코드/fields 추출', async () => {
  const f = mockFetch(400, { error: { code: 'VALIDATION_ERROR', message: '금액 오류', fields: { amount: '범위' } } });
  const api = createApi({ fetchImpl: f });
  await assert.rejects(() => api.createTransaction({}), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400); assert.equal(e.code, 'VALIDATION_ERROR');
    assert.equal(e.message, '금액 오류'); assert.deepEqual(e.fields, { amount: '범위' });
    return true;
  });
});

test('api: 429 Retry-After 추출', async () => {
  const f = mockFetch(429, { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x' } }, { 'Retry-After': '600' });
  const api = createApi({ fetchImpl: f });
  await assert.rejects(() => api.login('a@b.co', 'password1'), (e) => e.retryAfter === 600 && e.code === 'TOO_MANY_ATTEMPTS');
  assert.equal(parseRetryAfter('abc'), null);
  assert.equal(parseRetryAfter(null), null);
});

test('api: 401 은 일반 API 에서만 로그인 이동, 로그인/me 에서는 이동 안 함', async () => {
  let n = 0;
  const f = mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
  const api = createApi({ fetchImpl: f, onUnauthorized: () => { n++; } });
  await assert.rejects(() => api.listTransactions('2026-10'));
  assert.equal(n, 1);
  await assert.rejects(() => api.me());
  assert.equal(n, 1);
  const f2 = mockFetch(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } });
  const api2 = createApi({ fetchImpl: f2, onUnauthorized: () => { n++; } });
  await assert.rejects(() => api2.login('a@b.co', 'password1'));
  assert.equal(n, 1);
});

test('api: 네트워크 실패/JSON 아닌 응답', async () => {
  const api = createApi({ fetchImpl: async () => { throw new TypeError('fail'); } });
  await assert.rejects(() => api.summary('2026-10'), (e) => e.status === 0 && e.code === 'NETWORK_ERROR');
  const api2 = createApi({ fetchImpl: mockFetch(500, undefined) });
  await assert.rejects(() => api2.summary('2026-10'), (e) => e.status === 500 && /서버 오류/.test(e.message));
});

test('buildQuery: 빈 값 제외', () => {
  assert.equal(buildQuery({ a: '1', b: undefined, c: '' }), '?a=1');
  assert.equal(buildQuery({}), '');
});

test('authErrorMessage / waitText', () => {
  assert.equal(authErrorMessage({ code: 'INVALID_CREDENTIALS' }), '이메일 또는 비밀번호가 맞지 않아요');
  assert.equal(authErrorMessage({ code: 'EMAIL_TAKEN' }), '이미 가입된 이메일이에요');
  assert.match(authErrorMessage({ code: 'TOO_MANY_ATTEMPTS', retryAfter: 600 }), /10분 후/);
  assert.match(authErrorMessage({ status: 429, retryAfter: 61 }), /2분 후/);
  assert.match(authErrorMessage({ status: 429, retryAfter: 5 }), /1분 후/);
  assert.match(authErrorMessage({ status: 429, retryAfter: null }), /잠시 후/);
  assert.match(authErrorMessage({ code: 'SIGNUP_DISABLED' }), /가입/);
  assert.equal(authErrorMessage({ status: 400, message: '서버 문구' }), '서버 문구');
  assert.equal(waitText(0), '잠시');
});

const MONTHLY = [
  { month: '2026-08', incomeTotal: 0, expenseTotal: 0, balance: 0, count: 0 },
  { month: '2026-09', incomeTotal: 2500000, expenseTotal: 1000000, balance: 1500000, count: 5 },
  { month: '2026-10', incomeTotal: 2500000, expenseTotal: 1123000, balance: 1377000, count: 6 },
];

test('KPI: 전월 대비 증가/감소/없음', () => {
  const k = buildKpi(MONTHLY, '2026-10');
  assert.equal(k.expense, 1123000);
  assert.equal(k.balance, 1377000);
  assert.equal(k.change.direction, 'up');
  assert.equal(k.change.text, '지난달보다 12.3% 더 썼어요');
  const down = buildKpi(MONTHLY, '2026-09');
  assert.equal(down.change, null); // 전월(8월) 지출 0
  assert.equal(expenseChange(900, 1000).text, '지난달보다 10.0% 덜 썼어요');
  assert.equal(expenseChange(900, 1000).direction, 'down');
  assert.equal(expenseChange(1000, 1000).direction, 'same');
  assert.equal(expenseChange(5, 0), null);
  const none = buildKpi([], '2026-10');
  assert.deepEqual([none.income, none.expense, none.balance, none.change], [0, 0, 0, null]);
});

test('도넛/추이 어댑터', () => {
  const cat = { items: [{ category: '식비', total: 400000, count: 3, ratio: 0.5 }, { category: '교통', total: 0, ratio: 0 }] };
  assert.deepEqual(donutItemsFrom(cat), [{ label: '식비', value: 400000 }]);
  assert.deepEqual(donutItemsFrom({ grandTotal: 0, items: [] }), []);
  assert.deepEqual(donutItemsFrom(null), []);
  const trend = { months: ['2026-09', '2026-10'], series: [
    { category: '교통', totals: [1, 2], sum: 3 }, { category: '식비', totals: [5, 6], sum: 11 }] };
  assert.equal(defaultTrendCategory(cat, trend), '식비'); // 기준 월 1위
  assert.equal(defaultTrendCategory({ items: [] }, trend), '교통'); // series 첫째
  assert.equal(defaultTrendCategory(cat, { series: [] }), null);
  assert.deepEqual(trendCategories(trend).map((c) => c.category), ['교통', '식비']);
  assert.deepEqual(seriesFor(trend, '식비'), { seriesName: '식비', months: ['2026-09', '2026-10'], totals: [5, 6], colorIndex: 1 });
  assert.equal(seriesFor(trend, '쇼핑'), null);
});

test('인사이트 문장: api.md 6.3 예시', () => {
  const data = {
    recurring: [{ type: 'expense', memo: '넷플릭스', category: '문화/여가', amount: 17000, period: 'monthly', nextDate: '2026-11-04', dueSoon: true }],
    overspending: [
      { category: '식비', level: 'exceeded', currentTotal: 130000, baseline: 100000, projectedTotal: null, ratio: 1.3 },
      { category: '교통', level: 'pace', currentTotal: 44000, baseline: 100000, projectedTotal: 132000, ratio: 1.32 },
    ],
    largeExpenses: [{ transactionId: 'u', date: '2026-10-12', category: '쇼핑', memo: '패딩', amount: 250000, median: 40000, multiple: 6.3 }],
  };
  const secs = buildInsightSections(data);
  assert.deepEqual(secs.map((s) => s.key), ['overspending', 'recurring', 'large']);
  assert.equal(overspendingLine(data.overspending[0]).text, '식비: 이번 달 130,000원으로 평소 월 평균 100,000원보다 30% 더 썼어요');
  assert.equal(overspendingLine(data.overspending[0]).label, '초과');
  assert.match(overspendingLine(data.overspending[1]).text, /132,000원 예상/);
  assert.equal(recurringLine(data.recurring[0]).text, '넷플릭스 17,000원 매월 반복 지출 · 다음 예정 11월 4일');
  assert.equal(recurringLine(data.recurring[0]).strong, true);
  assert.equal(largeExpenseLine(data.largeExpenses[0]).text, '10월 12일 패딩 250,000원 (쇼핑) - 평소 중앙값 40,000원의 6.3배');
  assert.deepEqual(buildInsightSections({ recurring: [], overspending: [], largeExpenses: [] }), []);
  assert.deepEqual(buildInsightSections(null), []);
  const all = JSON.stringify(secs);
  assert.doesNotMatch(all, /NaN|undefined|Infinity|null/);
});

test('debounce: 마지막 호출만 실행, cancel', () => {
  const queue = [];
  let id = 0;
  const timers = {
    set: (fn, ms) => { queue.push({ id: ++id, fn, ms }); return id; },
    clear: (i) => { const k = queue.findIndex((q) => q.id === i); if (k >= 0) queue.splice(k, 1); },
  };
  const out = [];
  const d = debounce((v) => out.push(v), 200, timers);
  d('a'); d('b'); d('c');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].ms, 200);
  queue.shift().fn();
  assert.deepEqual(out, ['c']);
  d('x'); d.cancel();
  assert.equal(queue.length, 0);
});

test('debounce: 기본 타이머(실제 setTimeout)로도 동작', async () => {
  const out = [];
  const d = debounce((v) => out.push(v), 10);
  d(1); d(2);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(out, [2]);
});
