import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SORTS, SORT_LABEL, PAGE_SIZE, isDateSort, groupByMonth, listView, rowDateLabel, periodLabel,
  sortAnnounce, moreAnnounce, moreLabel, listCaption, createHistoryStore,
} from '../public/js/lib/history-data.js';
import { UNITS } from '../public/js/scroll-spring.js';
import { createApi } from '../public/js/api.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const tx = (id, date, amount = 1000, memo = '') => ({ id, type: 'expense', amount, category: '식비', memo, date, createdAt: `${date}T00:00:00.000Z` });
const months = [
  { month: '2026-10', total: 400000, count: 21 },
  { month: '2026-09', total: 410000, count: 20 },
  { month: '2026-03', total: 380000, count: 17 },
];

/** 대기 중인 응답을 테스트가 직접 푸는 가짜 fetchPage */
function fakeFetch() {
  const calls = [];
  const fn = (q) => new Promise((resolve, reject) => { calls.push({ q, resolve, reject }); });
  fn.calls = calls;
  return fn;
}
const page = (txs, nextCursor = null, extra = {}) => ({
  total: 1000, count: 100, firstDate: '2026-03-02', lastDate: '2026-10-28', months, transactions: txs, nextCursor, ...extra,
});
const tick = () => new Promise((r) => setImmediate(r));

test('정렬 정의: 4종, 날짜순만 월 묶음', () => {
  assert.deepEqual(SORTS, ['date_desc', 'date_asc', 'amount_desc', 'amount_asc']);
  assert.deepEqual(SORTS.map((s) => SORT_LABEL[s]), ['최신순', '오래된순', '금액 큰순', '금액 작은순']);
  assert.equal(PAGE_SIZE, 30);
  assert.deepEqual(SORTS.map(isDateSort), [true, true, false, false]);
});

test('groupByMonth: 최신순은 입력 순서대로 월 묶음, 소계는 months 값', () => {
  const txs = [tx('a', '2026-10-28'), tx('b', '2026-10-02'), tx('c', '2026-09-30')];
  const g = groupByMonth(txs, months);
  assert.deepEqual(g.map((x) => x.month), ['2026-10', '2026-09']);
  assert.deepEqual(g[0].items.map((t) => t.id), ['a', 'b']);
  // 불러온 행은 2건이지만 소계·건수는 그 달 전체
  assert.equal(g[0].total, 400000);
  assert.equal(g[0].count, 21);
  assert.equal(g[1].count, 20);
});

test('groupByMonth: 오래된순은 가장 오래된 달이 위, 달 안도 입력(오래된 것부터) 순서', () => {
  const txs = [tx('a', '2026-03-02'), tx('b', '2026-03-15'), tx('c', '2026-09-01')];
  const g = groupByMonth(txs, months);
  assert.deepEqual(g.map((x) => x.month), ['2026-03', '2026-09']);
  assert.deepEqual(g[0].items.map((t) => t.id), ['a', 'b']);
  assert.equal(g[0].total, 380000);
});

test('groupByMonth: months 에 없는 달은 소계 null, 빈 입력은 []', () => {
  assert.equal(groupByMonth([tx('a', '2025-01-01')], months)[0].total, null);
  assert.deepEqual(groupByMonth([], months), []);
  assert.deepEqual(groupByMonth(undefined, undefined), []);
});

test('listView: 날짜순은 grouped, 금액순은 묶음 없는 flat (입력 순서 유지)', () => {
  const txs = [tx('a', '2026-03-02', 9000), tx('b', '2026-10-28', 5000), tx('c', '2026-03-05', 1000)];
  const d = listView('date_desc', txs, months);
  assert.equal(d.mode, 'grouped');
  assert.ok(d.groups.length >= 2);
  for (const s of ['amount_desc', 'amount_asc']) {
    const v = listView(s, txs, months);
    assert.equal(v.mode, 'flat');
    assert.deepEqual(v.items.map((t) => t.id), ['a', 'b', 'c']);
    assert.equal(v.groups, undefined);
  }
});

test('rowDateLabel: 날짜순은 연도 없이, 금액순은 연도 포함', () => {
  assert.equal(rowDateLabel('2026-10-28', 'date_desc'), '10월 28일 (수)');
  assert.equal(rowDateLabel('2026-10-28', 'date_asc'), '10월 28일 (수)');
  assert.equal(rowDateLabel('2026-03-02', 'amount_desc'), '2026년 3월 2일 (월)');
  assert.equal(rowDateLabel('2026-03-02', 'amount_asc'), '2026년 3월 2일 (월)');
  assert.equal(rowDateLabel('bad', 'amount_asc'), 'bad');
});

test('periodLabel / 문구', () => {
  assert.equal(periodLabel('2026-03-02', '2026-10-28'), '2026년 3월 2일 ~ 2026년 10월 28일');
  assert.equal(periodLabel('2026-03-02', '2026-03-02'), '2026년 3월 2일');
  assert.equal(periodLabel(null, null), '');
  assert.equal(sortAnnounce('amount_desc', 120), '금액 큰순으로 정렬했어요. 120건');
  assert.equal(moreAnnounce(30, 60, 120), '30건 더 불러왔어요. 120건 중 60건');
  assert.equal(moreLabel(30, 120), '더 보기 (30/120)');
  assert.equal(listCaption('amount_desc', 30, 120), '금액 큰순, 120건 중 30건');
});

test('스토어: 열면 최신순 첫 쪽(커서 없음, limit 30)을 받는다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '식비' });
  assert.equal(st.state.status, 'loading');
  assert.deepEqual(f.calls[0].q, { type: 'expense', category: '식비', sort: 'date_desc', cursor: undefined, limit: 30 });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  assert.equal(await p, true);
  assert.equal(st.state.status, 'ready');
  assert.equal(st.state.summary.count, 100);
  assert.equal(st.state.nextCursor, 'c1');
  assert.equal(st.state.cursorSort, 'date_desc');
});

test('스토어: 더 보기는 커서를 이어 보내고 행을 이어 붙인다 (id 중복은 거른다)', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28'), tx('b', '2026-10-27')], 'c1'));
  await p;
  const m = st.more();
  assert.equal(f.calls[1].q.cursor, 'c1');
  assert.equal(f.calls[1].q.sort, 'date_desc');
  f.calls[1].resolve(page([tx('b', '2026-10-27'), tx('c', '2026-09-30')], null));
  assert.equal(await m, true);
  assert.deepEqual(st.state.txs.map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(st.state.added, 1);
  assert.equal(st.state.nextCursor, null);
  // 끝까지 불러왔으면 더 부르지 않는다
  assert.equal(await st.more(), false);
  assert.equal(f.calls.length, 2);
});

test('스토어: 더 보기가 진행 중이면 중복 요청하지 않는다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  await p;
  const m1 = st.more();
  const m2 = st.more();
  assert.equal(await m2, false);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(page([tx('b', '2026-10-27')], null));
  await m1;
});

test('스토어: 정렬을 바꾸면 커서 없이 처음부터 받고 목록을 비운다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  await p;
  const s = st.setSort('amount_desc');
  assert.equal(st.state.sort, 'amount_desc');
  assert.deepEqual(st.state.txs, []);
  assert.equal(st.state.nextCursor, null);
  assert.equal(f.calls[1].q.cursor, undefined);
  assert.equal(f.calls[1].q.sort, 'amount_desc');
  f.calls[1].resolve(page([tx('z', '2026-03-02', 99000)], 'c2'));
  await s;
  assert.deepEqual(st.state.txs.map((t) => t.id), ['z']);
  assert.equal(st.state.cursorSort, 'amount_desc');
  // 이어 붙일 때는 새 정렬의 커서
  const m = st.more();
  assert.equal(f.calls[2].q.cursor, 'c2');
  assert.equal(f.calls[2].q.sort, 'amount_desc');
  f.calls[2].resolve(page([], null));
  await m;
});

test('스토어: 같은 정렬을 다시 누르면 아무 일도 없다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')]));
  await p;
  assert.equal(await st.setSort('date_desc'), false);
  assert.equal(await st.setSort('nope'), false);
  assert.equal(f.calls.length, 1);
});

test('스토어: 늦게 도착한 응답은 버린다 (정렬을 빠르게 두 번 바꿔도 마지막 것만)', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p0 = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  await p0;
  const p1 = st.setSort('date_asc');
  const p2 = st.setSort('amount_desc');
  // 마지막 요청이 먼저 오고 첫 요청이 늦게 온다
  f.calls[2].resolve(page([tx('big', '2026-01-01', 90000)]));
  assert.equal(await p2, true);
  f.calls[1].resolve(page([tx('old', '2020-01-01')]));
  assert.equal(await p1, false);
  assert.deepEqual(st.state.txs.map((t) => t.id), ['big']);
  assert.equal(st.state.sort, 'amount_desc');
});

test('스토어: 더 보기 응답이 오기 전에 정렬을 바꾸면 그 응답은 버린다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p0 = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  await p0;
  const m = st.more();
  const s = st.setSort('amount_asc');
  f.calls[2].resolve(page([tx('x', '2026-02-02', 100)]));
  await s;
  f.calls[1].resolve(page([tx('late', '2026-09-09')], null));
  assert.equal(await m, false);
  assert.deepEqual(st.state.txs.map((t) => t.id), ['x']);
  assert.equal(st.state.moreStatus, 'idle');
});

test('스토어: 패널을 나가면(invalidate) 진행 중 응답을 버린다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '식비' });
  st.invalidate();
  f.calls[0].resolve(page([tx('a', '2026-10-28')]));
  assert.equal(await p, false);
  assert.deepEqual(st.state.txs, []);
});

test('스토어: 다시 열면 정렬은 최신순으로 돌아간다 (저장하지 않음)', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p0 = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')]));
  await p0;
  const s = st.setSort('amount_desc');
  f.calls[1].resolve(page([tx('a', '2026-10-28')]));
  await s;
  const p2 = st.open({ type: 'income', category: '부수입' });
  assert.equal(st.state.sort, 'date_desc');
  assert.deepEqual(f.calls[2].q, { type: 'income', category: '부수입', sort: 'date_desc', cursor: undefined, limit: 30 });
  f.calls[2].resolve(page([]));
  await p2;
});

test('스토어: 첫 쪽 실패는 error, 다시 시도는 지금 정렬로 처음부터', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p0 = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')]));
  await p0;
  const s = st.setSort('amount_desc');
  f.calls[1].reject(new Error('서버 오류가 발생했어요.'));
  assert.equal(await s, false);
  assert.equal(st.state.status, 'error');
  assert.equal(st.state.error, '서버 오류가 발생했어요.');
  const r = st.retry();
  assert.equal(f.calls[2].q.sort, 'amount_desc');
  assert.equal(f.calls[2].q.cursor, undefined);
  f.calls[2].resolve(page([tx('z', '2026-01-01')]));
  await r;
  assert.equal(st.state.status, 'ready');
});

test('스토어: 더 보기 실패는 이미 불러온 목록을 그대로 두고 다시 누를 수 있다', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p0 = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  await p0;
  const m = st.more();
  f.calls[1].reject(new Error('실패'));
  assert.equal(await m, false);
  assert.equal(st.state.moreStatus, 'error');
  assert.equal(st.state.moreError, '실패');
  assert.deepEqual(st.state.txs.map((t) => t.id), ['a']);
  assert.equal(st.state.nextCursor, 'c1');
  const m2 = st.more(); // 같은 커서로 다시
  assert.equal(f.calls[2].q.cursor, 'c1');
  f.calls[2].resolve(page([tx('b', '2026-10-27')], null));
  assert.equal(await m2, true);
  assert.deepEqual(st.state.txs.map((t) => t.id), ['a', 'b']);
});

test('스토어: 0건이면 summary.count 0, 이어 부를 것 없음', async () => {
  const f = fakeFetch();
  const st = createHistoryStore(f);
  const p = st.open({ type: 'expense', category: '없는' });
  f.calls[0].resolve({ total: 0, count: 0, firstDate: null, lastDate: null, months: [], transactions: [], nextCursor: null });
  await p;
  assert.equal(st.state.summary.count, 0);
  assert.equal(await st.more(), false);
  await tick();
});

test('스토어: 상태 변화를 onChange 로 알린다', async () => {
  const f = fakeFetch();
  const events = [];
  const st = createHistoryStore(f, (_s, ev) => events.push(ev));
  const p = st.open({ type: 'expense', category: '식비' });
  f.calls[0].resolve(page([tx('a', '2026-10-28')], 'c1'));
  await p;
  const s = st.setSort('amount_desc');
  f.calls[1].resolve(page([tx('a', '2026-10-28')], 'c2'));
  await s;
  const m = st.more();
  f.calls[2].resolve(page([], null));
  await m;
  assert.deepEqual(events, ['loading', 'open', 'loading', 'sort', 'more-loading', 'more']);
});

test('api.categoryHistory: GET /api/category-history 에 쿼리, 빈 값은 생략', async () => {
  const seen = [];
  const api = createApi({
    fetchImpl: async (url, init) => { seen.push([url, init.method]); return { ok: true, status: 200, json: async () => ({}) }; },
  });
  await api.categoryHistory('expense', '식비 & 외식', { sort: 'amount_desc', cursor: 'abc', limit: 30 });
  await api.categoryHistory('income', '부수입');
  const u = new URL(seen[0][0], 'http://x');
  assert.equal(u.pathname, '/api/category-history');
  assert.equal(u.searchParams.get('category'), '식비 & 외식');
  assert.equal(u.searchParams.get('sort'), 'amount_desc');
  assert.equal(u.searchParams.get('cursor'), 'abc');
  assert.equal(u.searchParams.get('limit'), '30');
  assert.equal(seen[0][1], 'GET');
  assert.equal(seen[1][0], '/api/category-history?type=income&category=%EB%B6%80%EC%88%98%EC%9E%85');
});

test('정적: 출렁임 유닛에 이력 요약 카드와 행이 있고 목록 카드·정렬·더 보기는 없다', () => {
  const sels = UNITS.map(([s]) => s);
  assert.equal(UNITS.find(([s]) => s === '#hist-summary')[1], 'card');
  assert.equal(UNITS.find(([s]) => s === '#hist-list .tx-date')[1], 'row');
  assert.equal(UNITS.find(([s]) => s === '#hist-list .tx-row')[1], 'row');
  for (const bad of ['#hist-card', '#hist-sort', '#hist-more', 'panel-history']) {
    assert.ok(!sels.some((s) => s.includes(bad)), bad);
  }
  const code = read('js/scroll-spring.js');
  assert.match(code, /const WATCH = \[[^\]]*'#hist-list'/);
  assert.match(code, /const WATCH = \[[^\]]*'#hist-summary'/);
});

test('정적: 패널·탭 등록과 정렬 그룹 마크업', () => {
  const html = read('index.html');
  assert.match(html, /<section id="panel-history"[^>]*aria-labelledby="hist-title"[^>]*hidden>/);
  assert.match(html, /id="hist-sort" role="group" aria-label="정렬"/);
  for (const s of SORTS) assert.match(html, new RegExp(`data-sort="${s}" aria-pressed="${s === 'date_desc'}"`));
  assert.match(html, /<h1 id="hist-title" tabindex="-1">/);
  assert.match(html, /id="hist-status"[^>]*role="status"/);
  const tabs = read('js/tabs.js');
  assert.match(tabs, /TABS = \[[^\]]*'history'/);
  assert.match(tabs, /history: 'record'/);
});

test('정적: history.js 는 innerHTML·인라인 style·element.animate 를 쓰지 않고, 막대 행은 버튼이다', () => {
  for (const f of ['js/history.js', 'js/lib/history-data.js']) {
    const code = read(f);
    assert.ok(!/innerHTML|insertAdjacentHTML|\.animate\(|\.style\./.test(code), f);
  }
  const rec = read('js/record.js');
  assert.match(rec, /class: 'cat-bar-btn'/);
  assert.match(rec, /사용 이력 보기/);
  assert.match(rec, /addEventListener\('edittx'/);
});
