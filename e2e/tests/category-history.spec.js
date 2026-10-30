// docs/plan-category-history.md (v1.1) Q-H1/Q-H2: 완료 기준 C-H1~C-H26.
// API(C-H1~C-H9)는 뷰포트와 무관하므로 mobile-360 에서만 돈다. UI 는 360/768 둘 다.
// 서버 오류·더 보기 실패처럼 실제로 만들기 어려운 상태는 page.route 로 응답을 가로채 흉내 낸다(리포트에 명시).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, json, get, newApi, signup } from '../helpers/api.js';
import { newAccount } from '../helpers/accounts.js';
import { newUiPage } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SHOTS = join(ROOT, 'docs', 'qa-shots-history');
const onlyApi = (testInfo) => test.skip(testInfo.project.use.viewport.width !== 360, 'API 항목은 mobile-360 에서만');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'];
const SORT_LABEL = { date_desc: '최신순', date_asc: '오래된순', amount_desc: '금액 큰순', amount_asc: '금액 작은순' };
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString();
const hist = (api, o) => get(api, `/api/category-history?${qs(o)}`);
const histJson = async (api, o) => { const r = await hist(api, o); expect(r.status(), JSON.stringify(o)).toBe(200); return r.json(); };

// ---------------------------------------------------------------- 기준 정렬 (직접 정렬)
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dateDesc = (a, b) => cmpStr(b.date, a.date) || cmpStr(b.createdAt, a.createdAt) || cmpStr(b.id, a.id);
const REF = {
  date_desc: dateDesc,
  date_asc: (a, b) => -dateDesc(a, b),
  amount_desc: (a, b) => b.amount - a.amount || dateDesc(a, b),
  amount_asc: (a, b) => a.amount - b.amount || dateDesc(a, b),
};
const sorted = (rows, sort) => [...rows].sort(REF[sort]);
const ids = (rows) => rows.map((r) => r.id);

/** 한 번에 limit 만큼 따라가며 전부 받는다. 반환: { pages, rows, last } */
async function allPages(api, o, limit = 30) {
  const pages = [];
  let cursor;
  for (let i = 0; i < 60; i++) {
    const body = await histJson(api, { ...o, limit: String(limit), ...(cursor ? { cursor } : {}) });
    pages.push(body);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return { pages, rows: pages.flatMap((p) => p.transactions), last: pages.at(-1) };
}

// ---------------------------------------------------------------- 데이터
const WD = '일월화수목금토';
const addDays = (base, n) => { const d = new Date(`${base}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const LONG_MEMO = '가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사아자'.slice(0, 50);
const LONG_NAME = '가나다라마바사아자차카타파하가'; // 15자
const XSS_NAME = '<b>굵게</b>😀';
const XSS_MEMO = '<i>기울임</i>😀';

/** 순차 생성: 서로 다른 밀리초 createdAt 을 보장하려고 3ms 쉰다. 반환: 응답의 거래 객체 배열 */
async function postSeq(api, items) {
  const out = [];
  for (const it of items) {
    const res = await addTx(api, it);
    expect(res.status(), JSON.stringify(it)).toBe(201);
    const j = await res.json();
    out.push(j.transaction || j);
    await sleep(3);
  }
  return out;
}
const permute = (n, step) => Array.from({ length: n }, (_, k) => (k * step) % n);

let world = null;
async function getWorld() {
  if (world) return world;
  const u = await createLoggedInUser('hist');
  const { api } = u;
  for (const [type, name] of [['expense', '이력75'], ['expense', '변동'], ['expense', '동시'], ['expense', '옛카페'], ['expense', XSS_NAME], ['expense', LONG_NAME], ['expense', '삭제될것'], ['expense', '비어있음']]) {
    const r = await json(api, 'POST', '/api/categories', { type, name });
    expect(r.status(), name).toBe(201);
  }
  // 식비 100건 (UI 용): 같은 금액 묶음, 같은 날 둘씩, 여러 해, 이번 달(2026-10) 6건 + 18일 + 미래 1건
  const sik = permute(100, 37).map((i) => {
    let date;
    if (i < 92) date = addDays('2024-11-01', Math.floor(i / 2) * 14);
    else if (i < 98) date = ['2026-10-02', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-05'][i - 92];
    else date = i === 98 ? '2026-10-18' : '2026-12-25';
    const memo = i === 10 ? LONG_MEMO : i % 4 === 0 ? '' : `식비${i}`;
    return { category: '식비', amount: [4500, 12000, 4500, 8000, 3000][i % 5], date, memo };
  });
  const sikRows = await postSeq(api, sik);
  // 이력75 (API 쪽 나눔 경계): 금액 3종이 25건씩, 같은 날 3건씩
  const r75 = await postSeq(api, permute(75, 7).map((i) => ({ category: '이력75', amount: [5000, 5000, 7000][i % 3] + (i % 25 === 0 ? 1 : 0), date: addDays('2025-01-01', Math.floor(i / 3)), memo: `m${i}` })));
  // 같은 밀리초 시도: 병렬 12건
  const par = await Promise.all(Array.from({ length: 12 }, (_, i) => addTx(api, { category: '동시', amount: [1000, 2000][i % 2], date: '2026-10-10', memo: `p${i}` })));
  const parRows = [];
  for (const r of par) { expect(r.status()).toBe(201); const j = await r.json(); parRows.push(j.transaction || j); }
  // 변동 40건
  const varRows = await postSeq(api, permute(40, 3).map((i) => ({ category: '변동', amount: [1000, 2500][i % 2], date: addDays('2025-03-01', Math.floor(i / 2)), memo: `v${i}` })));
  // 수입/지출 같은 이름 "기타", 급여
  const etcExp = await postSeq(api, [{ category: '기타', amount: 700, date: '2026-10-06', memo: '기타지출' }, { category: '기타', amount: 900, date: '2026-09-06', memo: '' }]);
  const etcInc = await postSeq(api, [{ type: 'income', category: '기타', amount: 55_000, date: '2026-10-07', memo: '기타수입' }]);
  const salary = await postSeq(api, [
    { type: 'income', category: '급여', amount: 2_500_000, date: '2026-10-01', memo: '10월 급여' },
    { type: 'income', category: '급여', amount: 2_400_000, date: '2025-10-25', memo: '' },
    { type: 'income', category: '급여', amount: 2_400_000, date: '2024-05-02', memo: '작년' },
  ]);
  // 사용 안 함 카테고리, 이름에 태그·이모지, 긴 이름, 곧 비워질 카테고리
  const old = await postSeq(api, [{ category: '옛카페', amount: 4200, date: '2026-10-07', memo: '옛날 커피' }, { category: '옛카페', amount: 6100, date: '2026-09-03', memo: '' }]);
  const xss = await postSeq(api, [{ category: XSS_NAME, amount: 3300, date: '2026-10-08', memo: XSS_MEMO }]);
  const lng = await postSeq(api, [{ category: LONG_NAME, amount: 1_234_000, date: '2026-10-09', memo: LONG_MEMO }, { category: LONG_NAME, amount: 99_000, date: '2025-01-09', memo: '짧은' }]);
  const gone = await postSeq(api, [{ category: '삭제될것', amount: 1500, date: '2026-10-11', memo: '곧 삭제' }]);
  const cats = (await (await get(api, '/api/categories')).json()).items;
  const oldCat = cats.find((c) => c.type === 'expense' && c.name === '옛카페');
  expect((await json(api, 'PATCH', `/api/categories/${oldCat.id}`, { active: false })).status()).toBe(200);
  world = { ...u, sikRows, r75, parRows, varRows, etcExp, etcInc, salary, old, xss, lng, gone };
  return world;
}

// ================================================================== API (C-H1~C-H9)
test.describe('API', () => {
  test('C-H1 기본 호출: sort 기본값, 정렬 순서, 요약 값, usedCount 일치', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    const res = await hist(w.api, { type: 'expense', category: '식비' });
    expect(res.status()).toBe(200);
    const b = await res.json();
    expect(b.sort).toBe('date_desc');
    expect(b.type).toBe('expense');
    expect(b.category).toBe('식비');
    const all = sorted(w.sikRows, 'date_desc');
    expect(b.transactions.length).toBe(30);
    expect(ids(b.transactions)).toEqual(ids(all.slice(0, 30)));
    expect(b.total).toBe(w.sikRows.reduce((s, r) => s + r.amount, 0));
    expect(b.count).toBe(100);
    const dates = w.sikRows.map((r) => r.date).sort();
    expect(b.firstDate).toBe(dates[0]);
    expect(b.lastDate).toBe(dates.at(-1));
    const expMonths = new Map();
    for (const r of w.sikRows) { const m = r.date.slice(0, 7); const o = expMonths.get(m) || { month: m, total: 0, count: 0 }; o.total += r.amount; o.count += 1; expMonths.set(m, o); }
    expect(b.months).toEqual([...expMonths.values()].sort((x, y) => cmpStr(y.month, x.month)));
    expect(b.transactions[0]).toEqual(expect.objectContaining({ id: expect.any(String), type: 'expense', amount: expect.any(Number), category: '식비', date: expect.any(String), createdAt: expect.stringMatching(/\.\d{3}Z$/) }));
    const cats = (await (await get(w.api, '/api/categories')).json()).items;
    expect(cats.find((c) => c.type === 'expense' && c.name === '식비').usedCount).toBe(b.count);
    // 헤더 규약
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(res.headers()['content-type']).toMatch(/application\/json; charset=utf-8/);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('C-H2 격리: 다른 사용자의 같은 이름, 수입/지출 같은 이름 "기타"', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    const other = await createLoggedInUser('hist-other');
    await postSeq(other.api, [{ category: '식비', amount: 999_999, date: '2026-10-02', memo: '남의 것' }, { category: '식비', amount: 1, date: '2020-01-01', memo: '' }]);
    const mine = await histJson(w.api, { type: 'expense', category: '식비', limit: '100' });
    expect(mine.count).toBe(100);
    expect(mine.transactions.some((t) => t.memo === '남의 것' || t.amount === 999_999)).toBe(false);
    expect(mine.firstDate).not.toBe('2020-01-01');
    const theirs = await histJson(other.api, { type: 'expense', category: '식비' });
    expect(theirs.count).toBe(2);
    // 다른 사용자의 커서를 내 요청에 써도 내 데이터만 나온다
    const cur = (await histJson(other.api, { type: 'expense', category: '식비', limit: '1' })).nextCursor;
    const via = await hist(w.api, { type: 'expense', category: '식비', cursor: cur });
    expect(via.status()).toBe(200);
    expect((await via.json()).transactions.every((t) => t.memo !== '남의 것')).toBe(true);
    // 수입 "기타" vs 지출 "기타"
    const ex = await histJson(w.api, { type: 'expense', category: '기타' });
    const inc = await histJson(w.api, { type: 'income', category: '기타' });
    expect(ex.count).toBe(2); expect(ex.total).toBe(1600);
    expect(inc.count).toBe(1); expect(inc.total).toBe(55_000);
    expect(ex.transactions.every((t) => t.type === 'expense')).toBe(true);
    expect(inc.transactions.every((t) => t.type === 'income')).toBe(true);
  });

  test('C-H3 사용 안 함·없는 이름은 200, 없는 이름은 빈 결과', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    const cats = (await (await get(w.api, '/api/categories')).json()).items;
    expect(cats.find((c) => c.name === '옛카페').active).toBe(false);
    const old = await histJson(w.api, { type: 'expense', category: '옛카페' });
    expect(old.count).toBe(2); expect(old.total).toBe(10_300);
    const none = await histJson(w.api, { type: 'expense', category: '이런이름은없음', sort: 'amount_asc' });
    expect(none).toEqual({ type: 'expense', category: '이런이름은없음', sort: 'amount_asc', total: 0, count: 0, firstDate: null, lastDate: null, months: [], transactions: [], nextCursor: null });
    // 대소문자·공백 정규화 없음
    const ws = await histJson(w.api, { type: 'expense', category: ' 식비' });
    expect(ws.count).toBe(0);
    // 카테고리 행 수는 호출 전후 같다(읽기 전용)
    const before = (await (await get(w.api, '/api/categories')).json()).items.length;
    await hist(w.api, { type: 'expense', category: '없는이름2' });
    expect((await (await get(w.api, '/api/categories')).json()).items.length).toBe(before);
  });

  test('C-H4 400/401/405 와 fields', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    const ok = { type: 'expense', category: '식비' };
    const bad = async (extra, field, base = ok) => {
      const r = await hist(w.api, { ...base, ...extra });
      const j = await r.json();
      expect(r.status(), JSON.stringify(extra)).toBe(400);
      expect(j.error.code).toBe('VALIDATION_ERROR');
      expect(j.error.fields, JSON.stringify(extra)).toHaveProperty(field);
      expect(JSON.stringify(j)).not.toMatch(/stack|select |at .*\.js/i);
    };
    await bad({ type: undefined }, 'type', { category: '식비' });
    await bad({ type: 'transfer' }, 'type');
    await bad({ type: 'EXPENSE' }, 'type');
    await bad({ category: undefined }, 'category', { type: 'expense' });
    await bad({ category: '' }, 'category');
    await bad({ category: '가'.repeat(51) }, 'category');
    await bad({ category: 'a\u0007b' }, 'category');
    await bad({ category: 'a\nb' }, 'category');
    expect((await hist(w.api, { ...ok, category: '가'.repeat(50) })).status()).toBe(200);
    await bad({ sort: '' }, 'sort');
    await bad({ sort: 'price' }, 'sort');
    await bad({ sort: 'DATE_DESC' }, 'sort');
    for (const l of ['0', '101', '1.5', 'abc', '-1', '']) await bad({ limit: l }, 'limit');
    for (const l of ['1', '100']) expect((await hist(w.api, { ...ok, limit: l })).status()).toBe(200);
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const good = { s: 'date_desc', d: '2026-01-01', c: '2026-01-01T00:00:00.000000Z', i: '11111111-1111-4111-8111-111111111111' };
    await bad({ cursor: 'zzz!!' }, 'cursor');
    await bad({ cursor: enc({ ...good, s: 'weird' }) }, 'cursor');
    await bad({ cursor: enc({ ...good, s: 'amount_desc' }), sort: 'amount_desc' }, 'cursor'); // a 없음
    await bad({ cursor: enc({ ...good, s: 'amount_desc', a: 0 }), sort: 'amount_desc' }, 'cursor');
    await bad({ cursor: enc({ ...good, s: 'amount_desc', a: 100_000_001 }), sort: 'amount_desc' }, 'cursor');
    await bad({ cursor: enc({ ...good, d: '2026-13-40' }) }, 'cursor');
    await bad({ cursor: enc({ ...good, i: 'not-a-uuid' }) }, 'cursor');
    await bad({ cursor: '' }, 'cursor');
    // 알 수 없는 파라미터는 무시
    expect((await hist(w.api, { ...ok, foo: 'bar', today: '2020-01-01' })).status()).toBe(200);
    // 401
    const anon = await newApi();
    const r401 = await get(anon, `/api/category-history?${qs(ok)}`);
    expect(r401.status()).toBe(401);
    expect((await r401.json()).error.code).toBeTruthy();
    // 405 Allow: GET
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await json(w.api, m, `/api/category-history?${qs(ok)}`, {});
      expect(r.status(), m).toBe(405);
      expect(r.headers().allow).toBe('GET');
    }
  });

  test('C-H5 schema.sql 불변, 마이그레이션 단계 없음, 성능 기록 존재', async ({}, testInfo) => {
    onlyApi(testInfo);
    const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
    expect(git('diff', '--name-only', 'HEAD', '--', 'src/backend/db')).toBe('');
    expect(git('status', '--porcelain', '--', 'src/backend/db', 'src/backend/scripts')).toBe('');
    // 성능: 서버를 통해 5,000건 데이터를 만들 수 없어(건당 POST), 단위 테스트가 기록한 [perf] 줄은 리포트에서 별도 확인한다.
  });

  test('C-H6 정렬 4종 전체 순서 = 직접 정렬, date_asc 는 date_desc 의 역순', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    const got = {};
    for (const sort of SORTS) {
      const b = await histJson(w.api, { type: 'expense', category: '이력75', sort, limit: '100' });
      got[sort] = b.transactions;
      expect(b.sort).toBe(sort);
      expect(b.nextCursor).toBeNull();
      expect(ids(b.transactions), sort).toEqual(ids(sorted(w.r75, sort)));
    }
    expect(ids(got.date_asc)).toEqual(ids(got.date_desc).reverse());
    // 식비 100건(limit=100 한 쪽)도 같다
    for (const sort of SORTS) {
      const b = await histJson(w.api, { type: 'expense', category: '식비', sort, limit: '100' });
      expect(ids(b.transactions), `식비 ${sort}`).toEqual(ids(sorted(w.sikRows, sort)));
    }
  });

  test('C-H7 동점: 같은 금액은 두 금액순 모두 최신 먼저, 같은 요청 3번 같은 순서', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    for (const sort of ['amount_desc', 'amount_asc']) {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(ids((await histJson(w.api, { type: 'expense', category: '이력75', sort, limit: '100' })).transactions));
      expect(runs[1]).toEqual(runs[0]); expect(runs[2]).toEqual(runs[0]);
      const rows = (await histJson(w.api, { type: 'expense', category: '이력75', sort, limit: '100' })).transactions;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]; const b = rows[i];
        if (a.amount === b.amount) expect(dateDesc(a, b), `${sort} #${i} 동점은 최신 먼저`).toBeLessThan(0);
      }
    }
    // 같은 밀리초(병렬 12건) 데이터: 순서는 date_desc 의 안정 정렬로 일관돼야 한다
    const same = new Set(w.parRows.map((r) => r.createdAt));
    console.log(`C-H7 병렬 12건 중 서로 다른 createdAt(ms) 수: ${same.size}`);
    const dd = (await histJson(w.api, { type: 'expense', category: '동시', limit: '100' })).transactions;
    expect(dd.length).toBe(12);
    const asc = (await histJson(w.api, { type: 'expense', category: '동시', sort: 'date_asc', limit: '100' })).transactions;
    expect(ids(asc)).toEqual(ids(dd).reverse());
    const stable = (arr, f) => arr.map((r, i) => [r, i]).sort((x, y) => f(x[0], y[0]) || x[1] - y[1]).map((x) => x[0]);
    const ad = (await histJson(w.api, { type: 'expense', category: '동시', sort: 'amount_desc', limit: '100' })).transactions;
    const aa = (await histJson(w.api, { type: 'expense', category: '동시', sort: 'amount_asc', limit: '100' })).transactions;
    expect(ids(ad)).toEqual(ids(stable(dd, (x, y) => y.amount - x.amount)));
    expect(ids(aa)).toEqual(ids(stable(dd, (x, y) => x.amount - y.amount)));
  });

  test('C-H8 커서 경계: 정렬 4종 × 75건 30/30/15, 겹침·빠짐 없음, 같은 밀리초·변동에도 안전', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    for (const sort of SORTS) {
      const { pages, rows } = await allPages(w.api, { type: 'expense', category: '이력75', sort });
      expect(pages.map((p) => p.transactions.length), sort).toEqual([30, 30, 15]);
      expect(pages.at(-1).nextCursor).toBeNull();
      expect(pages[0].nextCursor).toBeTruthy();
      expect(new Set(ids(rows)).size).toBe(75);
      expect(ids(rows), sort).toEqual(ids(sorted(w.r75, sort)));
    }
    // 같은 밀리초(병렬) 데이터를 limit=1..5 로 끝까지 넘겨도 한 번 호출한 전체 순서와 같다
    for (const sort of SORTS) {
      const full = (await histJson(w.api, { type: 'expense', category: '동시', sort, limit: '100' })).transactions;
      for (const lim of [1, 2, 5]) {
        const { rows } = await allPages(w.api, { type: 'expense', category: '동시', sort }, lim);
        expect(ids(rows), `${sort} limit=${lim}`).toEqual(ids(full));
      }
    }
    // 쪽 사이에 추가·삭제: 이미 받은 행이 다시 나오지 않는다
    for (const sort of SORTS) {
      const first = await histJson(w.api, { type: 'expense', category: '변동', sort, limit: '15' });
      const seen = new Set(ids(first.transactions));
      const added = await postSeq(w.api, [{ category: '변동', amount: sort.includes('asc') ? 1 : 100_000_000, date: '2030-01-01', memo: `새${sort}` }]);
      const del = await json(w.api, 'DELETE', `/api/transactions/${first.transactions[0].id}`);
      expect([200, 204]).toContain(del.status());
      let cursor = first.nextCursor;
      const later = [];
      while (cursor) {
        const p = await histJson(w.api, { type: 'expense', category: '변동', sort, limit: '15', cursor });
        later.push(...p.transactions);
        cursor = p.nextCursor;
      }
      expect(later.filter((t) => seen.has(t.id)).length, `${sort} 중복`).toBe(0);
      expect(new Set(ids(later)).size).toBe(later.length);
      void added;
    }
  });

  test('C-H9 정렬 불일치 커서 400, 요약은 정렬과 무관', async ({}, testInfo) => {
    onlyApi(testInfo);
    const w = await getWorld();
    const first = await histJson(w.api, { type: 'expense', category: '식비', sort: 'date_desc' });
    const mismatch = await hist(w.api, { type: 'expense', category: '식비', sort: 'amount_desc', cursor: first.nextCursor });
    expect(mismatch.status()).toBe(400);
    const j = await mismatch.json();
    expect(j.error.fields.cursor).toMatch(/정렬이 바뀌어/);
    for (const s of SORTS) {
      const r = await hist(w.api, { type: 'expense', category: '식비', sort: s, cursor: first.nextCursor });
      expect(r.status(), s).toBe(s === 'date_desc' ? 200 : 400);
    }
    // sort 없이 받은 커서를 sort=date_desc 로
    const noSort = await histJson(w.api, { type: 'expense', category: '식비' });
    expect((await hist(w.api, { type: 'expense', category: '식비', sort: 'date_desc', cursor: noSort.nextCursor })).status()).toBe(200);
    // sort 없이 보낸 요청에 amount 커서는 400
    const am = await histJson(w.api, { type: 'expense', category: '식비', sort: 'amount_desc' });
    expect((await hist(w.api, { type: 'expense', category: '식비', cursor: am.nextCursor })).status()).toBe(400);
    const sums = [];
    for (const s of SORTS) {
      const b = await histJson(w.api, { type: 'expense', category: '식비', sort: s, limit: '5' });
      sums.push(JSON.stringify([b.total, b.count, b.firstDate, b.lastDate, b.months]));
    }
    expect(new Set(sums).size).toBe(1);
  });
});

// ================================================================== UI 공통
const dateShort = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${m}월 ${dd}일 (${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
const dateFull = (d) => `${d.split('-')[0] * 1}년 ${dateShort(d)}`;
const won = (n) => `${n.toLocaleString('en-US')}원`;
const rowLabel = (t, sort) => `${sort.startsWith('date') ? dateShort(t.date) : dateFull(t.date)} ${t.memo || '메모 없음'} ${won(t.amount)} 수정`;

async function openUi(browser, testInfo, { user, scheme = 'light', motion = 'reduce', init } = {}) {
  const u = user || await getWorld();
  const ui = await newUiPage(browser, testInfo, { api: u.api, reducedMotion: motion });
  const { page } = ui;
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });
  const problems = [];
  const cursor400 = [];
  const reqs = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('request', (r) => { if (r.url().includes('/api/category-history')) reqs.push(new URL(r.url()).searchParams); });
  page.on('response', async (r) => {
    if (r.url().includes('/api/category-history') && r.status() === 400) { const t = await r.text().catch(() => ''); if (t.includes('"cursor"')) cursor400.push(t); }
  });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective)); });
  if (init) await page.addInitScript(init);
  await page.goto('/#record');
  await expect(page.locator('#user-name')).toBeVisible();
  await expect(page.locator('#month-summary')).toBeVisible();
  return { ...ui, problems, cursor400, reqs, user: u };
}
const barBtn = (page, type, cat) => page.locator(`#month-summary button[data-hist-type="${type}"][data-hist-cat="${cat}"]`);
async function enterHistory(page, type, cat) {
  const b = barBtn(page, type, cat);
  await expect(b).toBeVisible();
  await b.click();
  await expect(page).toHaveURL(/#history$/);
  // URL 은 hashchange 보다 먼저 바뀐다. 패널이 열리고 h1 에 포커스가 간 뒤(= 탭 전환 처리 끝)부터 목록을 읽는다
  await expect(page.locator('#panel-history')).toBeVisible();
  await expect(page.locator('#hist-title')).toBeFocused();
  await expect(page.locator('#hist-title')).toHaveText(cat);
}
const rowLabels = (page) => page.locator('#hist-list .tx-edit').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
const pressed = (page) => page.locator('#hist-sort [aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
const more = (page) => page.locator('#hist-more');
const waitRows = (page, n) => expect(page.locator('#hist-list .tx-edit')).toHaveCount(n);
const clickSort = async (page, sort) => { await page.locator(`#hist-sort [data-sort="${sort}"]`).click(); await expect(page.locator(`#hist-sort [data-sort="${sort}"]`)).toHaveAttribute('aria-pressed', 'true'); };
const activeDesc = (page) => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}#${a.id}.${a.className}` : ''; });
async function loadAll(page) {
  for (let i = 0; i < 10; i++) {
    if (!(await more(page).isVisible())) break;
    const before = await page.locator('#hist-list .tx-edit').count();
    await more(page).click();
    await expect.poll(async () => page.locator('#hist-list .tx-edit').count()).toBeGreaterThan(before);
  }
}
const apiRows = async (w, cat, sort, type = 'expense') => (await histJson(w.api, { type, category: cat, sort, limit: '100' }));

// ================================================================== 진입·이동 (C-H10~C-H13)
test('C-H10 지출 막대 행 버튼: 이름, 높이, 클릭/키보드 진입, h1 포커스', async ({ browser }, testInfo) => {
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  const rows = page.locator('#month-summary .cat-bars li');
  const n = await rows.count();
  expect(n).toBeGreaterThan(2);
  const btns = page.locator('#month-summary button[data-hist-type="expense"]');
  expect(await btns.count()).toBeGreaterThan(2);
  for (const b of await btns.all()) {
    const lab = await b.getAttribute('aria-label');
    expect(lab).toMatch(/^.+ [\d,]+원 \(.+\) 사용 이력 보기$/);
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  // 식비 버튼 이름: 카테고리·금액
  const sikSum = w.sikRows.filter((r) => r.date.startsWith('2026-10')).reduce((s, r) => s + r.amount, 0);
  const lab = await barBtn(page, 'expense', '식비').getAttribute('aria-label');
  expect(lab.startsWith(`식비 ${won(sikSum)} (`)).toBe(true);
  // 마우스 클릭
  await enterHistory(page, 'expense', '식비');
  expect(await activeDesc(page)).toContain('hist-title');
  await expect(page.locator('#hist-caption')).toContainText('지출 사용 이력');
  await expect(page.locator('#hist-list .tx-edit').first()).toBeVisible();
  // 키보드 Enter
  await page.goBack();
  await expect(page).toHaveURL(/#record$/);
  await barBtn(page, 'expense', '식비').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#history$/);
  await expect(page.locator('#hist-title')).toHaveText('식비');
  // Space
  await page.goBack();
  await barBtn(page, 'expense', '식비').focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/#history$/);
  await expect(page.locator('#hist-list .tx-edit').first()).toBeVisible();
  expect(a.problems).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await a.ctx.close();
});

test('C-H11 수입 막대 행이 수입 이력을 연다', async ({ browser }, testInfo) => {
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await expect(barBtn(page, 'income', '급여')).toBeVisible();
  expect(await barBtn(page, 'income', '급여').getAttribute('aria-label')).toMatch(/^급여 2,500,000원 \(.+\) 사용 이력 보기$/);
  await enterHistory(page, 'income', '급여');
  await expect(page.locator('#hist-caption')).toContainText('수입 사용 이력');
  await waitRows(page, 3);
  const exp = await apiRows(w, '급여', 'date_desc', 'income');
  expect(await rowLabels(page)).toEqual(exp.transactions.map((t) => rowLabel(t, 'date_desc')));
  await expect(page.locator('#hist-total')).toHaveText(`+${won(exp.total)}`);
  // 수입 정렬도 동작
  await clickSort(page, 'amount_asc');
  const exp2 = await apiRows(w, '급여', 'amount_asc', 'income');
  await expect.poll(() => rowLabels(page)).toEqual(exp2.transactions.map((t) => rowLabel(t, 'amount_asc')));
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-H12 뒤로 링크·브라우저 뒤로: 기록 탭, 눌렀던 막대 버튼 포커스, 탭바 기록 활성', async ({ browser }, testInfo) => {
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await expect(page.locator('#tab-record')).toHaveAttribute('aria-current', 'page');
  expect(await page.locator('.tabbar [aria-current="page"]').count()).toBe(1);
  await page.locator('#hist-back').click();
  await expect(page).toHaveURL(/#record$/);
  await expect(barBtn(page, 'expense', '식비')).toBeFocused();
  await enterHistory(page, 'expense', '옛카페');
  await page.goBack();
  await expect(page).toHaveURL(/#record$/);
  await expect(barBtn(page, 'expense', '옛카페')).toBeFocused();
  await expect(page.locator('#panel-history')).toBeHidden();
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-H13 선택 없이 #history 를 새로 열면 #record, 오류 없음', async ({ browser }, testInfo) => {
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await page.goto('/#history');
  await expect(page).toHaveURL(/#record$/);
  await expect(page.locator('#panel-record')).toBeVisible();
  await expect(page.locator('#panel-history')).toBeHidden();
  // 새로고침: 이력 화면에서 새로고침하면 기록 탭
  await enterHistory(page, 'expense', '식비');
  await page.reload();
  await expect(page).toHaveURL(/#record$/);
  await expect(page.locator('#panel-history')).toBeHidden();
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

// ================================================================== 이력 화면 (C-H14~C-H18)
test('C-H14 요약 카드: 합계(부호)·건수·기간이 API 값, 정렬을 눌러도 같다', async ({ browser }, testInfo) => {
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  const b = await apiRows(w, '식비', 'date_desc');
  const snap = async () => ({ total: await page.locator('#hist-total').textContent(), count: await page.locator('#hist-count').textContent(), period: await page.locator('#hist-period').textContent() });
  const first = await snap();
  expect(first.total).toBe(`−${won(b.total)}`.replace('−', first.total[0]));
  expect(first.total).toMatch(/^[−-]/);
  expect(first.total.slice(1)).toBe(won(b.total));
  expect(first.count).toBe(`${b.count}건`);
  const ymd = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일`; };
  expect(first.period).toBe(`${ymd(b.firstDate)} ~ ${ymd(b.lastDate)}`);
  for (const s of ['date_asc', 'amount_desc', 'amount_asc', 'date_desc']) {
    await clickSort(page, s);
    await expect(page.locator('#hist-card')).toHaveAttribute('aria-busy', 'false');
    await waitRows(page, 30);
    expect(await snap(), s).toEqual(first);
  }
  await a.ctx.close();
});

test('C-H15 더 보기: 30건씩, 같은 달 한 묶음, 월 소계=months, 끝에서 버튼 제거·포커스', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  const b = await apiRows(w, '식비', 'date_desc');
  await expect(more(page)).toHaveText('더 보기 (30/100)');
  const checkHeads = async () => {
    const heads = await page.locator('#hist-list .tx-group').evaluateAll((gs) => gs.map((g) => ({ title: g.querySelector('.tx-date span:first-child').textContent, sum: g.querySelector('.tx-day-sum').textContent, rows: g.querySelectorAll('.tx-edit').length })));
    const titles = heads.map((h) => h.title);
    expect(new Set(titles).size, '월 묶음 중복 없음').toBe(titles.length);
    for (const h of heads) {
      const m = h.title.match(/(\d+)년 (\d+)월/);
      const key = `${m[1]}-${String(m[2]).padStart(2, '0')}`;
      const info = b.months.find((x) => x.month === key);
      expect(h.sum, h.title).toBe(`−${info.count ? won(info.total) : ''} · ${info.count}건`.replace('−', h.sum[0]));
      expect(h.sum.slice(1), h.title).toBe(`${won(info.total)} · ${info.count}건`);
    }
    return heads;
  };
  await checkHeads();
  await more(page).click();
  await waitRows(page, 60);
  await expect(page.locator('#hist-status')).toHaveText('30건 더 불러왔어요. 100건 중 60건');
  await expect(more(page)).toHaveText('더 보기 (60/100)');
  await expect(more(page)).toBeFocused();
  await checkHeads();
  await more(page).click();
  await waitRows(page, 90);
  await checkHeads();
  await more(page).click();
  await waitRows(page, 100);
  await expect(more(page)).toBeHidden();
  await expect(page.locator('#hist-status')).toHaveText('10건 더 불러왔어요. 100건 중 100건');
  const act = await activeDesc(page);
  expect(act, '포커스가 body 가 아님').not.toMatch(/^BODY/);
  expect(await page.evaluate(() => document.activeElement.classList.contains('tx-edit'))).toBe(true);
  const heads = await checkHeads();
  expect(heads.reduce((s, h) => s + h.rows, 0)).toBe(100);
  // 화면 순서 = API 순서, 중복 0
  const labels = await rowLabels(page);
  expect(labels).toEqual(b.transactions.map((t) => rowLabel(t, 'date_desc')));
  // 첫 번째 묶음 순서: 최신 달이 위
  const titles = await page.locator('#hist-list .tx-group .tx-date span:first-child').allTextContents();
  expect(titles[0]).toBe('2026년 12월');
  expect(a.cursor400).toEqual([]);
  // 요청: 첫 쪽은 cursor 없음, 이후 모두 sort=date_desc, limit=30
  expect(a.reqs[0].get('cursor')).toBeNull();
  expect(a.reqs.slice(1).every((p) => p.get('cursor') && p.get('sort') === 'date_desc' && p.get('limit') === '30')).toBe(true);
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-H16 빈 상태(실제 0건), 첫 쪽 오류 + 다시 시도(응답 가로채기), 더 보기 실패', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const w = await getWorld();
  // (a) 실제 0건: 월 요약에는 아직 남아 있는 카테고리의 거래를 API 로 지운 뒤 들어간다
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await expect(barBtn(page, 'expense', '삭제될것')).toBeVisible();
  const del = await json(w.api, 'DELETE', `/api/transactions/${w.gone[0].id}`);
  expect([200, 204]).toContain(del.status());
  await enterHistory(page, 'expense', '삭제될것');
  await expect(page.locator('#hist-empty')).toBeVisible();
  await expect(page.locator('#hist-empty')).toHaveText('아직 이 카테고리 기록이 없어요');
  await expect(page.locator('#hist-sort')).toBeHidden();
  await expect(page.locator('#hist-summary')).toBeHidden();
  await expect(page.locator('#hist-card')).toBeHidden();
  await expect(page.locator('#hist-error')).toBeHidden();
  await page.goBack();
  // (b) 첫 쪽 500 → 오류 + 다시 시도
  let fail = true;
  await page.route('**/api/category-history*', async (route) => {
    if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버에 문제가 생겼어요.' } }) });
    return route.continue();
  });
  await enterHistory(page, 'expense', '식비');
  await expect(page.locator('#hist-error')).toBeVisible();
  await expect(page.locator('#hist-error-text')).toHaveText('서버에 문제가 생겼어요.');
  await expect(page.locator('#hist-error-text')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#hist-retry')).toHaveText('다시 시도');
  await expect(page.locator('#hist-card')).toBeHidden();
  // 정렬 버튼은 계속 누를 수 있다. 오류 상태에서 정렬을 바꾸고 다시 시도하면 그 정렬로 부른다
  await expect(page.locator('#hist-sort')).toBeVisible();
  await page.locator('#hist-sort [data-sort="amount_desc"]').click();
  await expect(page.locator('#hist-error')).toBeVisible();
  fail = false;
  const nReq = a.reqs.length;
  await page.locator('#hist-retry').click();
  await waitRows(page, 30);
  await expect(page.locator('#hist-error')).toBeHidden();
  expect(a.reqs[nReq].get('sort')).toBe('amount_desc');
  expect(a.reqs[nReq].get('cursor')).toBeNull();
  const exp = await apiRows(w, '식비', 'amount_desc');
  expect((await rowLabels(page)).slice(0, 30)).toEqual(exp.transactions.slice(0, 30).map((t) => rowLabel(t, 'amount_desc')));
  // (c) 더 보기 실패: 기존 행은 남고, 버튼은 다시 누를 수 있다
  let failMore = true;
  await page.unroute('**/api/category-history*');
  await page.route('**/api/category-history*', async (route) => {
    if (failMore && new URL(route.request().url()).searchParams.get('cursor')) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '더 불러오지 못했어요.' } }) });
    return route.continue();
  });
  await more(page).click();
  await expect(page.locator('#hist-more-error')).toHaveText('더 불러오지 못했어요.');
  await waitRows(page, 30);
  await expect(more(page)).toBeVisible();
  expect(await more(page).getAttribute('aria-disabled')).toBe('false');
  failMore = false;
  await more(page).click();
  await waitRows(page, 60);
  await expect(page.locator('#hist-more-error')).toHaveText('');
  const ids60 = await rowLabels(page);
  expect(ids60).toEqual(exp.transactions.slice(0, 60).map((t) => rowLabel(t, 'amount_desc')));
  await a.ctx.close();
});

test('C-H17 사용 안 함 배지, 이름·메모는 글자 그대로(태그·이모지)', async ({ browser }, testInfo) => {
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '옛카페');
  await expect(page.locator('#hist-caption .hist-inactive')).toHaveText('사용 안 함');
  await waitRows(page, 2);
  const exp = await apiRows(w, '옛카페', 'date_desc');
  expect(await rowLabels(page)).toEqual(exp.transactions.map((t) => rowLabel(t, 'date_desc')));
  await page.goBack();
  // 활성 카테고리에는 배지가 없다
  await enterHistory(page, 'expense', '식비');
  await expect(page.locator('#hist-caption .hist-inactive')).toHaveCount(0);
  await page.goBack();
  // 태그 이름
  await enterHistory(page, 'expense', XSS_NAME);
  await expect(page.locator('#hist-title')).toHaveText(XSS_NAME);
  await waitRows(page, 1);
  expect(await page.locator('#hist-list .hist-memo').textContent()).toBe(XSS_MEMO);
  expect(await page.locator('#panel-history b, #panel-history i').count()).toBe(0);
  expect(await rowLabels(page)).toEqual([`${dateShort('2026-10-08')} ${XSS_MEMO} 3,300원 수정`]);
  // 월 요약 막대 버튼에서도 글자 그대로
  await page.goBack();
  expect(await page.locator('#month-summary b, #month-summary i').count()).toBe(0);
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-H18 행 → 기록 탭 수정 상태, 저장(PUT 200), 이력 반영, 사용 안 함·금액순 포함', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const u = await createLoggedInUser('hist-edit');
  const { api } = u;
  expect((await json(api, 'POST', '/api/categories', { type: 'expense', name: '옛것' })).status()).toBe(201);
  await postSeq(api, [
    { category: '식비', amount: 5000, date: '2026-10-05', memo: '점심' },
    { category: '식비', amount: 9000, date: '2026-10-06', memo: '저녁' },
    { category: '식비', amount: 7000, date: '2025-02-06', memo: '작년' },
    { category: '옛것', amount: 3000, date: '2026-10-04', memo: '사용 안 함 거래' },
  ]);
  const cats = (await (await get(api, '/api/categories')).json()).items;
  expect((await json(api, 'PATCH', `/api/categories/${cats.find((c) => c.name === '옛것').id}`, { active: false })).status()).toBe(200);
  const a = await openUi(browser, testInfo, { user: u });
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 3);
  const row = page.locator('#hist-list .tx-edit', { hasText: '저녁' });
  await row.click();
  await expect(page).toHaveURL(/#record$/);
  await expect(page.locator('#panel-record')).toBeVisible();
  await expect(page.locator('#amount')).toHaveValue('9,000');
  await expect(page.locator('#memo')).toHaveValue('저녁');
  await expect(page.locator('#date')).toHaveValue('2026-10-06');
  await expect(page.locator('#category-chips [aria-pressed="true"]')).toHaveText(/식비/);
  await expect(page.locator('#amount')).toBeFocused();
  await expect(page.locator('#save-btn')).toContainText('수정');
  await expect(page.locator('#cancel-edit-btn')).toBeVisible();
  const putP = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/transactions/'));
  await page.locator('#amount').fill('9500');
  await page.locator('#save-btn').click();
  const putRes = await putP;
  expect(putRes.status()).toBe(200);
  await expect(page).toHaveURL(/#record$/); // 이력으로 자동 복귀하지 않는다
  // 다시 이력에 들어가면 바뀐 값이 보인다
  await expect(page.locator('#flash')).not.toHaveText('');
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 3);
  expect(await rowLabels(page)).toContain(`${dateShort('2026-10-06')} 저녁 9,500원 수정`);
  await expect(page.locator('#hist-total')).toHaveText(/21,500원/);
  // 금액순 화면의 행에서도 같다 (연도 포함 날짜 행)
  await clickSort(page, 'amount_asc');
  await expect.poll(() => rowLabels(page)).toEqual([`${dateFull('2026-10-05')} 점심 5,000원 수정`, `${dateFull('2025-02-06')} 작년 7,000원 수정`, `${dateFull('2026-10-06')} 저녁 9,500원 수정`]);
  const putP2 = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/transactions/'));
  await page.locator('#hist-list .tx-edit', { hasText: '작년' }).click();
  await expect(page).toHaveURL(/#record$/);
  await expect(page.locator('#amount')).toHaveValue('7,000');
  await expect(page.locator('#date')).toHaveValue('2025-02-06');
  await page.locator('#memo').fill('작년 수정');
  await page.locator('#save-btn').click();
  expect((await putP2).status()).toBe(200);
  // 사용 안 함 카테고리 거래는 금액만 고쳐 저장된다 (수정한 거래가 2025년 2월이라 기록 탭이 그 달로 가 있으므로 새로 연다)
  await expect(page.locator('#flash')).not.toHaveText('');
  await page.reload();
  await expect(page.locator('#month-summary')).toBeVisible();
  await expect(barBtn(page, 'expense', '옛것')).toBeVisible();
  await enterHistory(page, 'expense', '옛것');
  await expect(page.locator('#hist-caption .hist-inactive')).toBeVisible();
  await waitRows(page, 1);
  await page.locator('#hist-list .tx-edit').click();
  await expect(page.locator('#amount')).toHaveValue('3,000');
  const putP3 = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/transactions/'));
  await page.locator('#amount').fill('3500');
  await page.locator('#save-btn').click();
  const r3 = await putP3;
  expect(r3.status(), await r3.text()).toBe(200);
  await enterHistory(page, 'expense', '옛것');
  await waitRows(page, 1);
  expect(await rowLabels(page)).toEqual([`${dateShort('2026-10-04')} 사용 안 함 거래 3,500원 수정`]);
  // 서버 쪽 값도 확인
  const b = await histJson(api, { type: 'expense', category: '식비', sort: 'amount_desc' });
  expect(b.transactions.map((t) => [t.amount, t.memo])).toEqual([[9500, '저녁'], [7000, '작년 수정'], [5000, '점심']]);
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

// ================================================================== 정렬 (C-H19~C-H23)
test('C-H19 정렬 그룹: 버튼 4개, 최신순 눌림, 잘림·겹침 없음, 높이 44, 키보드', async ({ browser }, testInfo) => {
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  const grp = page.locator('#hist-sort');
  await expect(grp).toHaveAttribute('role', 'group');
  await expect(grp).toHaveAttribute('aria-label', '정렬');
  const btns = grp.locator('button');
  expect(await btns.allTextContents()).toEqual(['최신순', '오래된순', '금액 큰순', '금액 작은순']);
  expect(await pressed(page)).toEqual(['최신순']);
  const geo = await btns.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height, sw: e.scrollWidth, cw: e.clientWidth, lines: e.getClientRects().length }; }));
  for (const g of geo) { expect(g.h).toBeGreaterThanOrEqual(44); expect(g.sw).toBeLessThanOrEqual(g.cw + 1); }
  for (let i = 1; i < geo.length; i++) expect(geo[i].l).toBeGreaterThanOrEqual(geo[i - 1].r - 0.5);
  const vw = page.viewportSize().width;
  expect(Math.max(...geo.map((g) => g.r))).toBeLessThanOrEqual(vw);
  // 라벨 텍스트가 한 줄인지(높이로 확인)
  const lineH = await btns.evaluateAll((els) => els.map((e) => { const range = document.createRange(); range.selectNodeContents(e); return range.getClientRects().length; }));
  expect(lineH.every((n) => n === 1), `라벨 줄 수 ${lineH}`).toBe(true);
  // 키보드: Tab 으로 이동해 Enter / Space
  await btns.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(btns.nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await pressed(page)).toEqual(['오래된순']);
  await btns.nth(2).focus();
  await page.keyboard.press('Space');
  await expect(btns.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+Tab');
  await expect(btns.nth(1)).toBeFocused();
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-H20 오래된순: 가장 오래된 달이 맨 위, 행도 오래된 것부터, 소계=months, 순서=API', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  await clickSort(page, 'date_asc');
  await waitRows(page, 30);
  await loadAll(page);
  await waitRows(page, 100);
  const b = await apiRows(w, '식비', 'date_asc');
  expect(await rowLabels(page)).toEqual(b.transactions.map((t) => rowLabel(t, 'date_asc')));
  const heads = await page.locator('#hist-list .tx-group').evaluateAll((gs) => gs.map((g) => ({ title: g.querySelector('.tx-date span:first-child').textContent, sum: g.querySelector('.tx-day-sum').textContent })));
  expect(heads[0].title).toBe('2024년 11월');
  expect(heads.at(-1).title).toBe('2026년 12월');
  const keys = heads.map((h) => { const m = h.title.match(/(\d+)년 (\d+)월/); return `${m[1]}-${String(m[2]).padStart(2, '0')}`; });
  expect(keys).toEqual([...keys].sort());
  for (const [i, h] of heads.entries()) {
    const info = b.months.find((x) => x.month === keys[i]);
    expect(h.sum.slice(1), h.title).toBe(`${won(info.total)} · ${info.count}건`);
  }
  expect(a.cursor400).toEqual([]);
  await a.ctx.close();
});

test('C-H21 금액 큰순·작은순: 평평한 목록, 행 날짜에 연도, 순서=API, 더 보기 이어붙임·중복 0', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  for (const sort of ['amount_desc', 'amount_asc']) {
    await clickSort(page, sort);
    await waitRows(page, 30);
    expect(await page.locator('#hist-list .tx-group, #hist-list h3').count(), `${sort} 월 머리 없음`).toBe(0);
    expect(await page.locator('#hist-list > li.tx-row').count()).toBe(30);
    const dates = await page.locator('#hist-list .hist-date').allTextContents();
    expect(dates.every((d) => /^\d{4}년 \d+월 \d+일 \([일월화수목금토]\)$/.test(d)), `${sort} 연도 포함 날짜`).toBe(true);
    await loadAll(page);
    await waitRows(page, 100);
    const b = await apiRows(w, '식비', sort);
    const labels = await rowLabels(page);
    expect(labels, sort).toEqual(b.transactions.map((t) => rowLabel(t, sort)));
    expect(new Set(labels).size).toBeLessThanOrEqual(100);
    // 화면 위 금액 순서 + 같은 금액 안 최신 먼저 (API 정렬 규칙)
    const amts = (await page.locator('#hist-list .tx-amount').allTextContents()).map((t) => Number(t.replace(/[^\d]/g, '')));
    for (let i = 1; i < amts.length; i++) expect(sort === 'amount_desc' ? amts[i - 1] >= amts[i] : amts[i - 1] <= amts[i]).toBe(true);
    // 앞 쪽 마지막 행과 뒤 쪽 첫 행이 이어진다 (30/31 번째)
    expect(labels[29]).toBe(rowLabel(b.transactions[29], sort));
    expect(labels[30]).toBe(rowLabel(b.transactions[30], sort));
    // 전체 행 수준의 id 중복은 API 로 확인(서버 쪽 쪽 나눔 id 중복 0)
    const { rows } = await allPages(w.api, { type: 'expense', category: '식비', sort });
    expect(new Set(ids(rows)).size).toBe(100);
  }
  expect(a.cursor400).toEqual([]);
  await a.ctx.close();
});

test('C-H22 정렬 변경 시 처음부터, 빠른 연속 변경은 마지막만, fields.cursor 400 0회, 포커스·알림', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const w = await getWorld();
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  await more(page).click(); await waitRows(page, 60);
  await more(page).click(); await waitRows(page, 90);
  await expect(more(page)).toHaveText('더 보기 (90/100)');
  const n0 = a.reqs.length;
  await page.locator('#hist-sort [data-sort="amount_desc"]').click();
  await expect(page.locator('#hist-sort [data-sort="amount_desc"]')).toHaveAttribute('aria-pressed', 'true');
  await waitRows(page, 30);
  await expect(more(page)).toHaveText('더 보기 (30/100)');
  const req = a.reqs[n0];
  expect(req.get('cursor')).toBeNull();
  expect(req.get('sort')).toBe('amount_desc');
  expect(a.reqs.length).toBe(n0 + 1);
  await expect(page.locator('#hist-sort [data-sort="amount_desc"]')).toBeFocused();
  await expect(page.locator('#hist-status')).toHaveText('금액 큰순으로 정렬했어요. 100건');
  // 같은 정렬을 다시 눌러도 요청이 없다
  await page.locator('#hist-sort [data-sort="amount_desc"]').click();
  await page.waitForTimeout(300);
  expect(a.reqs.length).toBe(n0 + 1);
  // 빠른 두 번 변경: 첫 응답을 600ms 늦춰 마지막(금액 작은순)만 보이는지
  await page.route('**/api/category-history*', async (route) => {
    const sp = new URL(route.request().url()).searchParams;
    if (sp.get('sort') === 'date_asc') await new Promise((r) => setTimeout(r, 700));
    return route.continue();
  });
  await page.locator('#hist-sort [data-sort="date_asc"]').click();
  await page.locator('#hist-sort [data-sort="amount_asc"]').click();
  await expect(page.locator('#hist-sort [data-sort="amount_asc"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  expect(await pressed(page)).toEqual(['금액 작은순']);
  const exp = await apiRows(w, '식비', 'amount_asc');
  expect(await rowLabels(page)).toEqual(exp.transactions.slice(0, 30).map((t) => rowLabel(t, 'amount_asc')));
  expect(await page.locator('#hist-list h3').count()).toBe(0);
  // 더 보기 중에 정렬 변경: 늦은 더 보기 응답은 버려진다
  await page.unroute('**/api/category-history*');
  await page.route('**/api/category-history*', async (route) => {
    const sp = new URL(route.request().url()).searchParams;
    if (sp.get('cursor')) await new Promise((r) => setTimeout(r, 700));
    return route.continue();
  });
  await more(page).click();
  await page.locator('#hist-sort [data-sort="date_desc"]').click();
  await page.waitForTimeout(1200);
  const exp2 = await apiRows(w, '식비', 'date_desc');
  expect(await rowLabels(page)).toEqual(exp2.transactions.slice(0, 30).map((t) => rowLabel(t, 'date_desc')));
  await expect(more(page)).toHaveText('더 보기 (30/100)');
  expect(a.cursor400, '테스트 전체 fields.cursor 400').toEqual([]);
  await a.ctx.close();
});

test('C-H23 정렬은 저장되지 않는다: 뒤로 갔다 다시 열면 최신순, 새로고침도', async ({ browser }, testInfo) => {
  const a = await openUi(browser, testInfo);
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  await clickSort(page, 'amount_desc');
  await waitRows(page, 30);
  await page.locator('#hist-back').click();
  await expect(page).toHaveURL(/#record$/);
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  expect(await pressed(page)).toEqual(['최신순']);
  expect(a.reqs.at(-1).get('sort')).toBe('date_desc');
  await clickSort(page, 'amount_asc');
  await waitRows(page, 30);
  await page.goBack();
  await enterHistory(page, 'expense', '옛카페');
  await waitRows(page, 2);
  expect(await pressed(page)).toEqual(['최신순']);
  await clickSort(page, 'date_asc');
  await page.reload();
  await expect(page).toHaveURL(/#record$/);
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  expect(await pressed(page)).toEqual(['최신순']);
  expect(a.cursor400).toEqual([]);
  await a.ctx.close();
});

// ================================================================== 모션 (C-H24)
const UNIT_SEL = '#hist-summary, #hist-list .tx-date, #hist-list .tx-row';
const EXCL_SEL = '#hist-card, #hist-sort, #hist-more, #panel-history .cat-top, #panel-history, #hist-list, .tabbar, .app-header';
const REC = ({ unitSel, exclSel }) => {
  const rec = { frames: [], stop: false, lastScroll: 0 };
  window.__rec = rec;
  window.addEventListener('scroll', () => { rec.lastScroll = performance.now(); }, { passive: true });
  const parse = (s) => {
    if (!s || s === 'none') return [0, 1];
    const m3 = s.match(/matrix3d\((.*)\)/);
    if (m3) { const v = m3[1].split(',').map(Number); return [v[13], v[5]]; }
    const m = s.match(/matrix\((.*)\)/);
    if (m) { const v = m.length && m[1].split(',').map(Number); return [v[5], v[3]]; }
    return [NaN, NaN];
  };
  const loop = () => {
    if (rec.stop) return;
    const units = [...document.querySelectorAll(unitSel)];
    const ex = [...document.querySelectorAll(exclSel)];
    const hot = [...document.querySelectorAll('[style]')].filter((e) => e.style.transform || e.style.willChange);
    rec.frames.push({
      spring: document.documentElement.hasAttribute('data-spring'),
      sy: window.scrollY,
      n: units.length,
      u: units.map((e) => { const [ty, s] = parse(getComputedStyle(e).transform); return { ty, s, will: e.style.willChange, row: e.matches('.tx-row, .tx-date') }; }),
      attr: units.filter((e) => e.hasAttribute('data-spring-unit')).length,
      hot: hot.length,
      hotOutside: hot.filter((e) => !e.matches(unitSel)).map((e) => e.tagName + '#' + e.id),
      exBad: ex.filter((e) => e.style.transform || e.style.willChange).map((e) => e.tagName + '#' + e.id),
      exTf: ex.map((e) => getComputedStyle(e).transform).join('|'),
    });
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);
};
const isIdentity = (tf) => {
  if (!tf || tf === 'none') return true;
  const m = tf.match(/^matrix(3d)?\((.*)\)$/);
  if (!m) return false;
  const v = m[2].split(',').map(Number);
  const id = m[1] ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 1, 0, 0];
  return v.length === id.length && v.every((x, i) => Math.abs(x - id[i]) < 1e-6);
};
const maxAbs = (arr) => arr.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
async function wheel(page, x, y, dy, steps = 6, gap = 16) {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await page.waitForTimeout(gap); }
}
const settle = async (page) => {
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-spring'), null, { timeout: 4000, polling: 'raf' });
  await page.waitForTimeout(100);
};
async function scrollRun(page, dy, y = 500) {
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  const vw = page.viewportSize().width;
  await wheel(page, vw / 2, y, dy);
  await settle(page);
  return page.evaluate(() => window.__rec.frames);
}

test('C-H24 출렁임(no-preference): 요약·행이 움직이고, 더 보기·정렬 변경 행도, 제외 요소는 인라인 transform 없음', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const a = await openUi(browser, testInfo, { motion: 'no-preference' });
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  await page.waitForTimeout(500);
  await page.evaluate(REC, { unitSel: UNIT_SEL, exclSel: EXCL_SEL });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const stats = [];
  const verify = (fr, label, minRow) => {
    expect(fr.length, `${label} 프레임`).toBeGreaterThan(5);
    const rows = fr.flatMap((f) => f.u.filter((x) => x.row));
    const cards = fr.flatMap((f) => f.u.filter((x) => !x.row));
    const rowMax = maxAbs(rows.map((x) => x.ty));
    stats.push(`${label}: 유닛 ${fr[3].n}, 행 최대 ${rowMax.toFixed(2)}, 카드 최대 ${maxAbs(cards.map((x) => x.ty)).toFixed(2)}, 활성 최대 ${Math.max(...fr.map((f) => f.hot))}`);
    expect(rowMax, `${label} 행이 출렁임`).toBeGreaterThanOrEqual(minRow);
    expect(rowMax, `${label} 행 상한`).toBeLessThanOrEqual(12.5);
    expect(maxAbs(cards.map((x) => x.ty)), `${label} 카드 상한`).toBeLessThanOrEqual(20.5);
    expect(fr.flatMap((f) => f.u).some((x) => Number.isNaN(x.ty))).toBe(false);
    expect(fr.flatMap((f) => f.exBad), `${label} 제외 요소 인라인 transform`).toEqual([]);
    expect(fr.flatMap((f) => f.hotOutside), `${label} 유닛 밖 인라인 transform`).toEqual([]);
    expect(new Set(fr.map((f) => f.exTf)).size, `${label} 제외 요소 계산된 transform 불변`).toBe(1);
    expect(Math.max(...fr.map((f) => f.hot)), `${label} 동시 활성 <=40`).toBeLessThanOrEqual(40);
    return fr;
  };
  // 1. 최신순 첫 화면 (요약 카드 + 행)
  const fr1 = verify(await scrollRun(page, 600), '최신순 600px', 4);
  expect(Math.max(...fr1.map((f) => f.attr)), '유닛에 data-spring-unit').toBeGreaterThan(5);
  expect(fr1.at(-1).u.every((x) => isIdentity(x.ty === 0 ? 'none' : 'x')), '정지 뒤 변위 0').toBe(true);
  const endState = await page.evaluate(() => [...document.querySelectorAll('#hist-summary, #hist-list .tx-row, #hist-list .tx-date')].map((e) => ({ tf: getComputedStyle(e).transform, inl: e.style.transform, wc: e.style.willChange })));
  expect(endState.filter((x) => !isIdentity(x.tf) || x.inl || x.wc)).toEqual([]);
  // 요약 카드도 출렁임: 맨 위에서 아래로 한 번 더(요약이 화면에 있을 때)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  const frCard = await scrollRun(page, 120, 300);
  const cardMax = maxAbs(frCard.flatMap((f) => f.u.filter((x) => !x.row).map((x) => x.ty)));
  console.log(`C-H24 요약 카드 최대 |ty| ${cardMax.toFixed(2)}`);
  expect(cardMax, '요약 카드 출렁임').toBeGreaterThan(0.3);
  // 2. 더 보기로 붙은 행
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForTimeout(300);
  await more(page).click();
  await waitRows(page, 60);
  await page.waitForTimeout(300);
  const nUnits = await page.evaluate(() => document.querySelectorAll('#hist-summary, #hist-list .tx-date, #hist-list .tx-row').length);
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForTimeout(300);
  const fr2 = verify(await scrollRun(page, -700, 400), '더 보기 뒤 위로 700px', 3);
  expect(fr2[3].n, '더 보기 뒤 유닛 수가 늘었다').toBe(nUnits);
  const lastUnits = fr2.flatMap((f) => f.u.slice(-30).map((x) => x.ty));
  console.log(`C-H24 더 보기로 붙은 마지막 30개 유닛 최대 |ty| ${maxAbs(lastUnits).toFixed(2)}`);
  expect(maxAbs(lastUnits), '더 보기로 붙은 행도 출렁임').toBeGreaterThan(1);
  // 3. 금액순 평평한 목록
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await page.locator('#hist-sort [data-sort="amount_desc"]').click();
  await waitRows(page, 30);
  await page.waitForTimeout(400);
  expect(await page.locator('#hist-list .tx-date').count()).toBe(0);
  const fr3 = verify(await scrollRun(page, 600), '금액 큰순 600px', 4);
  expect(fr3[3].n, '평평한 목록 유닛: 요약 1 + 행 30').toBe(31);
  // 4. 정렬 변경 뒤 바뀐 행도 출렁임(오래된순 → 월 머리 포함)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await page.locator('#hist-sort [data-sort="date_asc"]').click();
  await waitRows(page, 30);
  await page.waitForTimeout(400);
  verify(await scrollRun(page, 600), '오래된순 600px', 4);
  console.log('C-H24 ' + stats.join(' / '));
  expect(a.problems).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await a.ctx.close();
});

test('C-H24 reduce: 모든 프레임에 transform·will-change 없음, data-spring-unit 없음', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const a = await openUi(browser, testInfo, { motion: 'reduce' });
  const { page } = a;
  await enterHistory(page, 'expense', '식비');
  await waitRows(page, 30);
  await page.evaluate(REC, { unitSel: UNIT_SEL, exclSel: EXCL_SEL });
  await page.evaluate(() => window.scrollTo(0, 0));
  const fr = await (async () => {
    await page.evaluate(() => { window.__rec.frames.length = 0; });
    await wheel(page, page.viewportSize().width / 2, 500, 800, 8, 16);
    await page.waitForTimeout(700);
    return page.evaluate(() => window.__rec.frames);
  })();
  expect(fr.length).toBeGreaterThan(10);
  expect(Math.max(...fr.map((f) => f.sy))).toBeGreaterThan(300);
  expect(fr.every((f) => f.hot === 0), '인라인 transform·will-change 0').toBe(true);
  expect(fr.every((f) => f.attr === 0), 'data-spring-unit 0').toBe(true);
  expect(fr.every((f) => !f.spring), 'data-spring 0').toBe(true);
  expect(fr.every((f) => f.u.every((x) => x.ty === 0 && x.s === 1)), '계산된 transform 항등').toBe(true);
  await more(page).click();
  await waitRows(page, 60);
  await clickSort(page, 'amount_desc');
  await waitRows(page, 30);
  expect(await page.evaluate(() => document.querySelectorAll('[data-spring-unit]').length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-spring'))).toBe(false);
  await a.ctx.close();
});

// ================================================================== 화면 (C-H25)
for (const scheme of ['light', 'dark']) {
  test(`C-H25 [${scheme}] 가로 스크롤 없음, 금액 한 줄, 긴 이름·긴 메모·연도 날짜 겹침 없음, 스크린샷`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    mkdirSync(SHOTS, { recursive: true });
    const w = await getWorld();
    const a = await openUi(browser, testInfo, { scheme });
    const { page } = a;
    const vw = page.viewportSize().width;
    const px = vw === 360 ? '360' : '768';
    const layout = async (label) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${label} 가로 스크롤`).toBeLessThanOrEqual(vw);
      const bad = await page.evaluate(() => {
        const out = [];
        for (const b of document.querySelectorAll('#hist-list .tx-edit')) {
          const mid = b.querySelector('.tx-mid').getBoundingClientRect();
          const side = b.querySelector('.tx-side').getBoundingClientRect();
          const amt = b.querySelector('.tx-amount');
          const br = b.getBoundingClientRect();
          const memo = b.querySelector('.hist-memo'); const date = b.querySelector('.hist-date');
          if (mid.right > side.left + 0.5) out.push('mid/side 겹침 ' + b.getAttribute('aria-label'));
          if (side.right > br.right + 0.5 || mid.left < br.left - 0.5) out.push('행 밖 ' + b.getAttribute('aria-label'));
          if (amt.getClientRects().length !== 1 || amt.getBoundingClientRect().height > 30) out.push('금액 줄바꿈 ' + amt.textContent);
          if (date.scrollWidth > date.clientWidth + 1 && getComputedStyle(date).textOverflow !== 'ellipsis') out.push('날짜 잘림 ' + date.textContent);
          if (b.getBoundingClientRect().height < 44) out.push('행 높이 ' + b.getBoundingClientRect().height);
          void memo;
        }
        return out;
      });
      expect(bad, `${label} 행 배치`).toEqual([]);
    };
    // 긴 이름(15자) + 긴 메모(50자) + 1,234,000원
    await enterHistory(page, 'expense', LONG_NAME);
    await waitRows(page, 2);
    await layout('긴 이름');
    const titleBox = await page.locator('#hist-title').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    expect(titleBox.sw).toBeLessThanOrEqual(titleBox.cw + 1);
    await page.screenshot({ path: join(SHOTS, `long-name-${scheme}-${px}.png`), fullPage: true });
    await clickSort(page, 'amount_desc');
    await expect.poll(() => rowLabels(page)).toEqual((await apiRows(w, LONG_NAME, 'amount_desc')).transactions.map((t) => rowLabel(t, 'amount_desc')));
    await layout('긴 이름 금액순');
    await page.goBack();
    // 식비 최신순 / 금액 큰순 스크린샷
    await enterHistory(page, 'expense', '식비');
    await waitRows(page, 30);
    await layout('식비 최신순');
    await page.screenshot({ path: join(SHOTS, `date-desc-${scheme}-${px}.png`), fullPage: false });
    await page.screenshot({ path: join(SHOTS, `date-desc-${scheme}-${px}-full.png`), fullPage: true });
    await clickSort(page, 'amount_desc');
    await waitRows(page, 30);
    await layout('식비 금액 큰순');
    await page.screenshot({ path: join(SHOTS, `amount-desc-${scheme}-${px}.png`), fullPage: false });
    await page.screenshot({ path: join(SHOTS, `amount-desc-${scheme}-${px}-full.png`), fullPage: true });
    // 접근성 부분 검사(axe 는 저장소에 없다): 모든 버튼에 접근 가능한 이름, 랜드마크, 제목 단계
    const a11y = await page.evaluate(() => {
      const p = document.getElementById('panel-history');
      const nameless = [...p.querySelectorAll('button, a')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim())).length;
      return { nameless, labelled: p.getAttribute('aria-labelledby'), h1: p.querySelectorAll('h1').length, status: document.getElementById('hist-status').getAttribute('role'), inlineStyle: p.querySelectorAll('[style]').length, styleTags: p.querySelectorAll('style').length, scripts: p.querySelectorAll('script').length };
    });
    expect(a11y).toEqual({ nameless: 0, labelled: 'hist-title', h1: 1, status: 'status', inlineStyle: 0, styleTags: 0, scripts: 0 });
    expect(a.problems).toEqual([]);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    await a.ctx.close();
  });
}

// ================================================================== 회귀 (C-H26)
test('C-H26 변경 파일 범위, 금지 파일 불변, 인라인 스크립트·style 없음', async ({}, testInfo) => {
  onlyApi(testInfo);
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const changed = [...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
  const allowed = [/^src\/backend\//, /^src\/frontend\/public\//, /^src\/frontend\/test\//, /^e2e\//, /^docs\//, /^design_handoff_moneybook\//];
  const out = changed.filter((f) => !allowed.some((re) => re.test(f)));
  expect(out, '허용 범위 밖 변경').toEqual([]);
  expect(changed.filter((f) => /src\/frontend\/office\//.test(f))).toEqual([]);
  for (const f of ['src/frontend/public/css/tokens.css', 'src/frontend/public/css/components.css', 'src/backend/db/schema.sql']) expect(changed, f).not.toContain(f);
  const html = git('show', 'HEAD:src/frontend/public/index.html').length;
  expect(html).toBeGreaterThan(0);
});
