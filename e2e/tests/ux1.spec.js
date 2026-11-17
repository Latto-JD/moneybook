// docs/plan-ux1.md 7장: UX 묶음 1 완료 기준 UX-01~UX-31.
// "터치"는 hasTouch 컨텍스트의 tap(), "마우스"는 click(), "키보드"는 press() 만 쓴다. 시계는 2026-10-19 12:00 KST 고정(시험별로 바꾸기도 한다).
// 서버 오류·되돌리기 400 은 page.route 로 응답을 가로채 흉내 낸다. 실제 폰 키보드/홈 화면 동작은 자동화할 수 없어 리포트에서 '사용자 확인'으로 둔다.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, json, get, newApi, signup } from '../helpers/api.js';
import { newAccount, PASSWORD } from '../helpers/accounts.js';
import { newUiPage } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (ti) => ti.project.use.viewport.width;
const onlyMobile = (ti) => test.skip(widthOf(ti) !== 360, '이 항목은 mobile-360 에서만');
const WD = '일월화수목금토';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 앱 열기. touch=true 면 뷰포트와 무관하게 hasTouch 컨텍스트(tap 가능). */
async function open(browser, testInfo, { scheme = 'light', hash = '#record', prepare, user, touch = false, now, motion = 'reduce' } = {}) {
  const u = user || await createLoggedInUser('ux');
  if (prepare) await prepare(u.api);
  const ti = touch ? { project: { use: { ...testInfo.project.use, hasTouch: true } } } : testInfo;
  const ui = await newUiPage(browser, ti, { api: u.api, reducedMotion: motion });
  const { page, ctx } = ui;
  if (now) await ctx.clock.setFixedTime(new Date(now));
  page.removeAllListeners('dialog');
  const dialogs = [];
  let dialogAnswer = 'accept';
  page.on('dialog', async (d) => { dialogs.push({ type: d.type(), message: d.message() }); if (d.type() === 'confirm' && dialogAnswer === 'accept') await d.accept(); else await d.dismiss(); });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });
  const problems = []; const reqs = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('request', (r) => { const p = new URL(r.url()); if (p.pathname.startsWith('/api/')) reqs.push(`${r.method()} ${p.pathname}${p.search}`); });
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toBeVisible();
  return { ...u, ...ui, dialogs, problems, reqs, answer: (v) => { dialogAnswer = v; } };
}

const active = (page) => page.evaluate(() => { const a = document.activeElement; return { id: a.id, tag: a.tagName, cls: a.className, row: a.closest('.tx-row')?.dataset.id || null }; });
const rect = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);
const txs = async (api, month) => (await (await get(api, `/api/transactions?month=${month}`)).json()).transactions;
const mkTxs = async (api, n = 20, month = '2026-10') => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await addTx(api, { category: i % 2 ? '식비' : '교통', amount: 1000 + i * 10, date: `${month}-${String((i % 19) + 1).padStart(2, '0')}`, memo: `m${i}` });
    expect(r.status()).toBe(201);
    out.push(await r.json());
  }
  return out;
};
const idOf = (list, memo) => (list.find((t) => t.memo === memo) || {}).id;
const openDate = async (page) => { if (!(await page.locator('#date-details').evaluate((d) => d.open))) await page.locator('#date-details > summary').click(); };
const pickCat = (page, name = '식비') => page.locator('#category-chips button', { hasText: name }).first();
/** 새 기록 입력: 입력 방식에 따라 tap/click */
async function fillNew(page, how, { amount = '5000', cat = '식비', submit = true } = {}) {
  const act = (loc) => (how === 'touch' ? loc.tap() : loc.click());
  await act(page.locator('#amount'));
  await page.keyboard.type(amount);
  await act(pickCat(page, cat));
  if (submit) await act(page.locator('#save-btn'));
}

test.describe('U14 저장 후 숫자 패드', () => {
  test('UX-01 터치 저장 후 #save-btn 포커스, 입력 요소 포커스 없음, 스크롤 위치 같음', async ({ browser }, testInfo) => {
    const { page, problems } = await open(browser, testInfo, { touch: true });
    await page.locator('#amount').tap();
    await page.keyboard.type('5000');
    await pickCat(page).tap();
    const y0 = await page.evaluate(() => window.scrollY);
    await page.locator('#save-btn').tap();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect.poll(async () => (await active(page)).id).toBe('save-btn');
    expect(['INPUT', 'TEXTAREA']).not.toContain((await active(page)).tag);
    await sleep(300);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(2);
    expect(problems).toEqual([]);
  });

  test('UX-02 터치로 금액 칸을 누른 뒤 Enter 로 저장해도 #save-btn', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { touch: true });
    await pickCat(page).tap();
    await page.locator('#amount').tap();
    await page.keyboard.type('4200');
    await page.keyboard.press('Enter');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect.poll(async () => (await active(page)).id).toBe('save-btn');
    expect(['INPUT', 'TEXTAREA']).not.toContain((await active(page)).tag);
  });

  test('UX-03 마우스 클릭 저장과 키보드만 저장은 #amount 포커스', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo);
    await fillNew(page, 'mouse');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect.poll(async () => (await active(page)).id).toBe('amount');
    // 키보드만: 포인터 입력 없이 새 페이지
    const k = await open(browser, testInfo);
    await k.page.locator('#amount').focus();
    await k.page.keyboard.type('3000');
    await k.page.locator('#category-chips button').first().focus();
    await k.page.keyboard.press('Enter');
    await k.page.locator('#amount').focus();
    await k.page.keyboard.press('Enter');
    await expect(k.page.locator('#flash')).toHaveText('저장했어요');
    await expect.poll(async () => (await active(k.page)).id).toBe('amount');
  });

  test('UX-04 터치 저장 뒤 토스트·되돌리기 접근 이름, Shift+Tab 한 번에 도달, 5초 타이머·포커스 시 멈춤', async ({ browser }, testInfo) => {
    test.setTimeout(60_000);
    const { page } = await open(browser, testInfo, { touch: true });
    await fillNew(page, 'touch');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    const undo = page.locator('#flash-undo');
    await expect(undo).toBeVisible();
    await expect(undo).toHaveAccessibleName('방금 저장한 기록 되돌리기');
    await expect.poll(async () => (await active(page)).id).toBe('save-btn');
    // 타이머(포커스 없음): 약 5초 뒤 사라진다
    await expect(undo).toBeHidden({ timeout: 8000 });
    // 다시 저장해 Shift+Tab 으로 도달, 포커스 중에는 멈춘다
    await fillNew(page, 'touch', { amount: '6000' });
    await expect(undo).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    expect((await active(page)).id).toBe('flash-undo');
    await sleep(6500);
    await expect(undo).toBeVisible();
  });

  test('UX-05 되돌리기 후 포커스: 터치 #save-btn / 마우스 #amount / 키보드 #amount', async ({ browser }, testInfo) => {
    const t = await open(browser, testInfo, { touch: true });
    await fillNew(t.page, 'touch');
    await t.page.locator('#flash-undo').tap();
    await expect(t.page.locator('#flash')).toHaveText('되돌렸어요');
    await expect.poll(async () => (await active(t.page)).id).toBe('save-btn');
    const m = await open(browser, testInfo);
    await fillNew(m.page, 'mouse');
    await m.page.locator('#flash-undo').click();
    await expect(m.page.locator('#flash')).toHaveText('되돌렸어요');
    await expect.poll(async () => (await active(m.page)).id).toBe('amount');
    // 키보드: 저장은 마우스, 되돌리기는 포커스+Enter (마지막 포인터 입력은 마우스)
    const k = await open(browser, testInfo);
    await k.page.locator('#amount').focus(); await k.page.keyboard.type('2500');
    await k.page.locator('#category-chips button').first().focus(); await k.page.keyboard.press('Enter');
    await k.page.locator('#amount').focus(); await k.page.keyboard.press('Enter');
    await expect(k.page.locator('#flash-undo')).toBeVisible();
    await k.page.locator('#flash-undo').focus();
    await k.page.keyboard.press('Enter');
    await expect(k.page.locator('#flash')).toHaveText('되돌렸어요');
    await expect.poll(async () => (await active(k.page)).id).toBe('amount');
  });

  test('UX-06 터치 저장 뒤 #save-btn 은 :focus-visible 아님, 키보드 Tab 으로 오면 포커스 링', async ({ browser }, testInfo) => {
    const t = await open(browser, testInfo, { touch: true });
    await fillNew(t.page, 'touch');
    await expect.poll(async () => (await active(t.page)).id).toBe('save-btn');
    expect(await t.page.locator('#save-btn').evaluate((b) => b.matches(':focus-visible'))).toBe(false);
    const k = await open(browser, testInfo);
    await k.page.locator('#date-yesterday').focus();
    await k.page.keyboard.press('Tab'); // 날짜 요약
    await k.page.keyboard.press('Tab'); // 저장 버튼
    expect((await active(k.page)).id).toBe('save-btn');
    const ring = await k.page.locator('#save-btn').evaluate((b) => ({ fv: b.matches(':focus-visible'), ow: parseFloat(getComputedStyle(b).outlineWidth), os: getComputedStyle(b).outlineStyle, sh: getComputedStyle(b).boxShadow }));
    expect(ring.fv).toBe(true);
    expect(ring.sh, JSON.stringify(ring)).not.toBe('none'); // 이 앱의 포커스 링은 outline 대신 box-shadow(--shadow-focus)
  });

  test('UX-07 터치에서 금액 없이 저장하면 #amount 로 포커스', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { touch: true });
    await pickCat(page).tap();
    await page.locator('#save-btn').tap({ force: true }); // 금액이 없어 aria-disabled=true 라 force
    await expect(page.locator('#amount-error')).not.toBeEmpty();
    expect((await active(page)).id).toBe('amount');
  });
});

test.describe('U2 수정 후 행으로', () => {
  for (const how of ['mouse', 'touch']) {
    test(`UX-08 (${how}) 아래쪽 행 수정 저장 -> 같은 행 .tx-edit 포커스, 화면 안, 바뀐 금액`, async ({ browser }, testInfo) => {
      const { page, api } = await open(browser, testInfo, { touch: how === 'touch', prepare: (a) => mkTxs(a, 20) });
      const list = await txs(api, '2026-10');
      const id = idOf(list, 'm0'); // 가장 오래된 날짜 -> 목록 맨 아래쪽
      const act = (l) => (how === 'touch' ? l.tap() : l.click());
      const row = page.locator(`.tx-row[data-id="${id}"]`);
      await expect(row).toHaveCount(1);
      await act(row.locator('.tx-edit'));
      await expect(page.locator('#save-btn')).toContainText('수정');
      await page.locator('#amount').fill('7777');
      await act(page.locator('#save-btn'));
      await expect(page.locator('#flash')).toHaveText('수정했어요');
      await expect.poll(async () => (await active(page)).row, { timeout: 8000 }).toBe(String(id));
      const a = await active(page);
      expect(a.cls).toContain('tx-edit');
      await sleep(300);
      const v = await page.evaluate((i) => {
        const r = document.querySelector(`.tx-row[data-id="${i}"]`).getBoundingClientRect();
        const dock = document.querySelector('#save-dock').getBoundingClientRect();
        const tab = document.querySelector('.tabbar').getBoundingClientRect();
        const head = document.querySelector('.app-header').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, dockTop: dock.top, dockBottom: dock.bottom, tabTop: tab.top, headBottom: head.bottom, vh: innerHeight, text: document.querySelector(`.tx-row[data-id="${i}"]`).innerText };
      }, id);
      expect(v.top, JSON.stringify(v)).toBeGreaterThanOrEqual(0);
      expect(v.bottom, JSON.stringify(v)).toBeLessThanOrEqual(Math.min(v.vh, v.tabTop) + 0.5); // 탭바에 가리지 않음
      expect(v.dockBottom > v.top && v.dockTop < v.bottom, '저장 영역과 겹침 ' + JSON.stringify(v)).toBe(false);
      expect(v.text).toContain('7,777원');
    });
  }

  test('UX-09 수정 취소도 같은 행으로, 목록 요청 추가 없음', async ({ browser }, testInfo) => {
    const { page, api, reqs } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 20) });
    const id = idOf(await txs(api, '2026-10'), 'm1');
    await page.locator(`.tx-row[data-id="${id}"] .tx-edit`).click();
    await expect(page.locator('#cancel-edit-btn')).toBeVisible();
    const n0 = reqs.length;
    await page.locator('#cancel-edit-btn').click();
    await expect.poll(async () => (await active(page)).row).toBe(String(id));
    await sleep(500);
    expect(reqs.slice(n0)).toEqual([]);
    expect(await page.locator('#cancel-edit-btn').isHidden()).toBe(true);
  });

  test('UX-10 다른 달로 옮겨 저장하면 그 달 목록의 행으로, 행이 없으면 #month-title-h, body 로 가지 않음', async ({ browser }, testInfo) => {
    const { page, api } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 16) });
    const id = idOf(await txs(api, '2026-10'), 'm3');
    await page.locator(`.tx-row[data-id="${id}"] .tx-edit`).click();
    await openDate(page);
    await page.locator('#date').fill('2026-09-10');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    await expect(page.locator('#month-title-h')).toContainText('9월');
    await expect.poll(async () => (await active(page)).row).toBe(String(id));
    // 행이 없는 경우: 9월 목록 응답을 빈 목록으로 가로챈다
    const id2 = idOf(await txs(api, '2026-10'), 'm4');
    await page.route('**/api/transactions?month=2026-08*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: [] }) }));
    await page.locator('#month-prev').click();
    await expect(page.locator('#month-title-h')).toContainText('8월');
    await page.locator('#month-next').click();
    await page.locator('#month-next').click();
    await expect(page.locator('#month-title-h')).toContainText('10월');
    await page.locator(`.tx-row[data-id="${id2}"] .tx-edit`).click();
    await openDate(page);
    await page.locator('#date').fill('2026-08-10');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    await expect(page.locator('#month-title-h')).toContainText('8월');
    await expect.poll(async () => (await active(page)).id).toBe('month-title-h');
  });

  test('UX-11 이력 화면에서 연 수정도 같은 행으로 돌아가고 reduce 모션에서 즉시 스크롤', async ({ browser }, testInfo) => {
    const { page, api } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 20) });
    const id = idOf(await txs(api, '2026-10'), 'm0');
    // 카테고리 막대를 펼쳐 '교통' 이력을 연다 (m0 은 교통)
    await page.locator('#month-cats > summary').click();
    await page.locator('.cat-bar-btn', { hasText: '교통' }).first().click();
    await expect(page.locator('#hist-list button').first()).toBeVisible();
    await page.locator('#hist-list button', { hasText: '1,000원' }).first().click();
    await expect(page.locator('#save-btn')).toContainText('수정');
    await page.locator('#amount').fill('8888');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    await expect.poll(async () => (await active(page)).row, { timeout: 8000 }).toBe(String(id));
    // reduce: 스크롤은 즉시 -> 저장 직후 0.4초 안에 행이 화면 안
    const inView = await page.evaluate((i) => { const r = document.querySelector(`.tx-row[data-id="${i}"]`).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, id);
    expect(inView).toBe(true);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    // 강조는 1.2초 뒤 제거
    await expect(page.locator(`.tx-row[data-id="${id}"]`)).not.toHaveClass(/tx-row--landed/, { timeout: 3000 });
  });
});

test.describe('U3 삭제 되돌리기', () => {
  test('UX-12 활성 카테고리 삭제: dialog 없음, 행 사라짐, 토스트+되돌리기, 포커스는 같은 자리 다음 행', async ({ browser }, testInfo) => {
    const { page, api, dialogs } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 6) });
    const list = await txs(api, '2026-10');
    const rows = await page.locator('#tx-list .tx-row').evaluateAll((els) => els.map((e) => e.dataset.id));
    const target = rows[1];
    const nextId = rows[2];
    await page.locator(`.tx-row[data-id="${target}"] .tx-del`).click();
    await expect(page.locator('#flash')).toHaveText('삭제했어요');
    await expect(page.locator('#flash-undo')).toBeVisible();
    await expect(page.locator('#flash-undo')).toHaveAccessibleName('방금 삭제한 기록 되돌리기');
    await expect(page.locator(`.tx-row[data-id="${target}"]`)).toHaveCount(0);
    expect(dialogs).toEqual([]);
    await expect.poll(async () => (await active(page)).row).toBe(nextId);
    expect(list.length).toBe(6);
    // 마지막 행을 지우면 (기존 규칙) 새 마지막 행, 목록이 비면 월 제목
    for (let guard = 0; guard < 10; guard++) {
      const ids = await page.locator('#tx-list .tx-row').evaluateAll((els) => els.map((e) => e.dataset.id));
      if (!ids.length) break;
      const last = ids.at(-1);
      await page.locator(`.tx-row[data-id="${last}"] .tx-del`).click();
      await expect(page.locator(`.tx-row[data-id="${last}"]`)).toHaveCount(0);
      if (ids.length > 1) await expect.poll(async () => (await active(page)).row).toBe(ids.at(-2));
    }
    await expect.poll(async () => (await active(page)).id).toBe('month-title-h');
    expect(dialogs).toEqual([]);
  });

  test('UX-13 되돌리기: POST 1회, 같은 내용 복원(목록·합계·대시보드), 포커스 되살린 행, "되돌렸어요"', async ({ browser }, testInfo) => {
    const { page, api, reqs } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 8) });
    const list = await txs(api, '2026-10');
    const t = list.find((x) => x.memo === 'm5');
    const sum0 = await (await get(api, '/api/summary?month=2026-10')).json();
    await page.locator(`.tx-row[data-id="${t.id}"] .tx-del`).click();
    await expect(page.locator(`.tx-row[data-id="${t.id}"]`)).toHaveCount(0);
    const n0 = reqs.length;
    await page.locator('#flash-undo').dblclick(); // 빠른 두 번 누름
    await expect(page.locator('#flash')).toHaveText('되돌렸어요');
    await expect.poll(async () => (await active(page)).cls, { timeout: 8000 }).toContain('tx-edit');
    const posts = reqs.slice(n0).filter((r) => r.startsWith('POST /api/transactions'));
    expect(posts).toHaveLength(1);
    const after = await txs(api, '2026-10');
    const back = after.filter((x) => x.memo === 'm5');
    expect(back).toHaveLength(1);
    for (const k of ['type', 'amount', 'category', 'memo', 'date']) expect(back[0][k], k).toBe(t[k]);
    expect(after).toHaveLength(8);
    const a = await active(page);
    expect(a.row).toBe(String(back[0].id));
    expect(await get(api, '/api/summary?month=2026-10').then((r) => r.json())).toEqual(sum0);
    await expect(page.locator('#tx-list')).toContainText('m5');
    await page.locator('#tab-dashboard').click();
    await expect(page.locator('#kpi')).toContainText(/원/);
    const kpi = await page.locator('#kpi').innerText();
    expect(kpi).toContain(sum0.expenseTotal.toLocaleString('en-US') + '원');
  });

  test('UX-14 사용 안 함 카테고리 거래: dialog, 취소하면 유지, 확인하면 삭제되고 되돌리기 없음', async ({ browser }, testInfo) => {
    const o = await open(browser, testInfo, {
      prepare: async (api) => {
        await mkTxs(api, 3);
        const cats = await (await get(api, '/api/categories')).json();
        const c = cats.items.find((x) => x.type === 'expense' && x.name === '교통');
        expect((await json(api, 'PATCH', `/api/categories/${c.id}`, { active: false })).status()).toBe(200);
      },
    });
    const { page, api, dialogs } = o;
    const m = (await txs(api, '2026-10')).find((x) => x.category === '교통');
    const row = page.locator(`.tx-row[data-id="${m.id}"]`);
    o.answer('dismiss');
    await row.locator('.tx-del').click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0].type).toBe('confirm');
    await sleep(300);
    await expect(row).toHaveCount(1);
    expect((await txs(api, '2026-10')).some((x) => x.id === m.id)).toBe(true);
    o.answer('accept');
    await row.locator('.tx-del').click();
    await expect(row).toHaveCount(0);
    expect(dialogs).toHaveLength(2);
    await expect(page.locator('#flash')).toHaveText('삭제했어요');
    await expect(page.locator('#flash-undo')).toBeHidden();
  });

  test('UX-15 되돌리기 POST 400 -> 안내 문구, 목록 그대로, POST 1회', async ({ browser }, testInfo) => {
    const { page, api, reqs } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 5) });
    const t = (await txs(api, '2026-10')).find((x) => x.memo === 'm2');
    await page.route('**/api/transactions', async (r) => {
      if (r.request().method() === 'POST') { await sleep(200); return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION', message: '잘못된 값' } }) }); }
      return r.continue();
    });
    await page.locator(`.tx-row[data-id="${t.id}"] .tx-del`).click();
    await expect(page.locator(`.tx-row[data-id="${t.id}"]`)).toHaveCount(0);
    const n0 = reqs.length;
    await page.locator('#flash-undo').dblclick();
    await expect(page.locator('#flash')).toHaveText('되살리지 못했어요. 다시 입력해 주세요');
    expect(reqs.slice(n0).filter((r) => r.startsWith('POST /api/transactions'))).toHaveLength(1);
    expect((await txs(api, '2026-10')).some((x) => x.memo === 'm2')).toBe(false);
    await expect(page.locator('#tx-list')).not.toContainText('m2');
  });

  test('UX-16 다른 달 거래를 지우고 되돌리면 그 달 목록에 다시 보임', async ({ browser }, testInfo) => {
    const { page, api } = await open(browser, testInfo, { prepare: async (a) => { await mkTxs(a, 3); await mkTxs(a, 3, '2026-09'); } });
    await page.locator('#month-prev').click();
    await expect(page.locator('#month-title-h')).toContainText('9월');
    const t = (await txs(api, '2026-09')).find((x) => x.memo === 'm1');
    await page.locator(`.tx-row[data-id="${t.id}"] .tx-del`).click();
    await expect(page.locator(`.tx-row[data-id="${t.id}"]`)).toHaveCount(0);
    await page.locator('#month-next').click();
    await expect(page.locator('#month-title-h')).toContainText('10월');
    await page.locator('#flash-undo').click();
    await expect(page.locator('#flash')).toHaveText('되돌렸어요');
    await expect(page.locator('#month-title-h')).toContainText('9월');
    await expect(page.locator('#tx-list')).toContainText('m1');
    expect((await txs(api, '2026-09')).filter((x) => x.memo === 'm1')).toHaveLength(1);
  });
});

test.describe('U1 날짜 빠른 선택', () => {
  test('UX-17 오늘/어제 버튼, 요약, 저장 날짜 (3월 1일 -> 2월 28일, 윤년 2월 29일, 1월 1일 -> 전년 12월 31일)', async ({ browser }, testInfo) => {
    const { page, api } = await open(browser, testInfo);
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#date-summary')).toHaveText('오늘');
    await expect(page.locator('#date-details > summary')).toHaveText('날짜: 오늘');
    await page.locator('#date-yesterday').click();
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#date-details > summary')).toHaveText('날짜: 어제');
    await fillNew(page, 'mouse');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    expect((await txs(api, '2026-10')).map((t) => t.date)).toEqual(['2026-10-18']);
    // 경계
    for (const [now, month, want] of [['2027-03-01T12:00:00+09:00', '2027-02', '2027-02-28'], ['2028-03-01T12:00:00+09:00', '2028-02', '2028-02-29'], ['2027-01-01T12:00:00+09:00', '2026-12', '2026-12-31']]) {
      const b = await open(browser, testInfo, { now });
      await b.page.locator('#date-yesterday').click();
      await expect(b.page.locator('#date')).toHaveValue(want);
      await fillNew(b.page, 'mouse');
      await expect(b.page.locator('#flash')).toHaveText('저장했어요');
      expect((await txs(b.api, month)).map((t) => t.date), now).toEqual([want]);
    }
  });

  test('UX-18 달력으로 오늘/어제/다른 날 선택 시 버튼 상태와 요약, 목록 머리줄 형식 유지', async ({ browser }, testInfo) => {
    const { page, api } = await open(browser, testInfo, { prepare: (a) => addTx(a, { amount: 1234, date: '2026-10-14', memo: 'hd' }) });
    await openDate(page);
    await page.locator('#date').fill('2026-10-18');
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#date').fill('2026-10-19');
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#date').fill('2026-10-14');
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'false');
    const wd = WD[new Date('2026-10-14T00:00:00Z').getUTCDay()];
    await expect(page.locator('#date-summary')).toHaveText(`10월 14일 (${wd})`);
    // 빠른 선택은 열린 details 를 닫지 않는다
    await page.locator('#date-yesterday').click();
    expect(await page.locator('#date-details').evaluate((d) => d.open)).toBe(true);
    // 목록 머리줄 형식: 같은 함수(dayLabel)가 바뀌지 않았는지 -> 머리줄 텍스트
    const head = await page.locator('#tx-list .tx-date').first().innerText();
    expect(head).toMatch(/10월 14일/);
    expect(head).not.toMatch(/^날짜:/);
    expect(api).toBeTruthy();
  });

  test('UX-19 어제 선택 시 초기화 아이콘, 초기화하면 오늘, 수정 시작 시 버튼 상태, 높이 44px, 접근 이름', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, {
      prepare: async (a) => { await addTx(a, { amount: 1111, date: '2026-10-18', memo: 'yd' }); await addTx(a, { amount: 2222, date: '2026-10-05', memo: 'old' }); },
    });
    const grp = page.getByRole('group', { name: '날짜 빠른 선택' });
    await expect(grp).toBeVisible();
    await expect(grp.getByRole('button', { name: '오늘' })).toBeVisible();
    await expect(grp.getByRole('button', { name: '어제' })).toBeVisible();
    expect((await rect(page, '#date-today')).h).toBeGreaterThanOrEqual(43.5);
    expect((await rect(page, '#date-yesterday')).h).toBeGreaterThanOrEqual(43.5);
    await expect(page.locator('#reset-btn')).toBeHidden();
    await page.locator('#date-yesterday').click();
    await expect(page.locator('#reset-btn')).toBeVisible();
    await page.locator('#reset-btn').click();
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#date-summary')).toHaveText('오늘');
    await page.locator('.tx-row', { hasText: 'yd' }).locator('.tx-edit').click();
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#date-summary')).toHaveText('어제');
    await page.locator('#cancel-edit-btn').click();
    await page.locator('.tx-row', { hasText: 'old' }).locator('.tx-edit').click();
    await expect(page.locator('#date-yesterday')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#cancel-edit-btn').click();
    await expect(page.locator('#date-today')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('U5 카테고리 블록', () => {
  const seed = (a) => mkTxs(a, 12);
  test('UX-20 새 저장소: #month-cats 접힘, 막대 안 보임, 첫 행이 펼친 때보다 위 (360x740 측정)', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { prepare: seed });
    expect(await page.locator('#month-cats').evaluate((d) => d.open)).toBe(false);
    await expect(page.locator('#month-summary')).toBeHidden();
    await expect(page.locator('.cat-bar-btn').first()).toBeHidden();
    const docTop = async () => (await rect(page, '#tx-list .tx-row')).t + (await page.evaluate(() => window.scrollY));
    const closed = await docTop();
    await page.locator('#month-cats > summary').click();
    await expect(page.locator('.cat-bar-btn').first()).toBeVisible();
    const opened = await docTop();
    console.log(`UX-20 ${widthOf(testInfo)}px 첫 행 top(문서 기준 px): 접힘 ${closed.toFixed(0)} / 펼침 ${opened.toFixed(0)}`);
    expect(closed).toBeLessThan(opened);
  });

  test('UX-21 펼침 기억: 새로고침 후에도 펼침, 접으면 키 삭제 후 접힘', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { prepare: seed });
    await page.locator('#month-cats > summary').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mb-month-cats'))).toBe('open');
    await page.reload();
    await expect(page.locator('#user-name')).toBeVisible();
    expect(await page.locator('#month-cats').evaluate((d) => d.open)).toBe(true);
    await expect(page.locator('.cat-bar-btn').first()).toBeVisible();
    await page.locator('#month-cats > summary').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mb-month-cats'))).toBeNull();
    await page.reload();
    await expect(page.locator('#user-name')).toBeVisible();
    expect(await page.locator('#month-cats').evaluate((d) => d.open)).toBe(false);
  });

  test('UX-22 막대 -> 이력 -> 뒤로 시 같은 막대에 포커스, 요약 줄 44px, Enter/Space 로 여닫힘', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { prepare: seed });
    expect((await rect(page, '#month-cats > summary')).h).toBeGreaterThanOrEqual(43.5);
    const sum = page.locator('#month-cats > summary');
    await sum.focus();
    await page.keyboard.press('Enter');
    expect(await page.locator('#month-cats').evaluate((d) => d.open)).toBe(true);
    await page.keyboard.press('Space');
    expect(await page.locator('#month-cats').evaluate((d) => d.open)).toBe(false);
    await page.keyboard.press('Space');
    expect(await page.locator('#month-cats').evaluate((d) => d.open)).toBe(true);
    const bar = page.locator('.cat-bar-btn').first();
    const cat = await bar.getAttribute('data-hist-cat');
    await bar.click();
    await expect(page.locator('#hist-title')).toBeVisible();
    await page.locator('#hist-back').click();
    await expect(page.locator('#hist-title')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement.dataset.histCat || null)).toBe(cat);
  });

  test('UX-23 펼치고 접은 뒤 스크롤해도 오류 없음 (출렁임 본 시험은 spring.spec.js)', async ({ browser }, testInfo) => {
    onlyMobile(testInfo);
    const { page, problems } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 30), touch: true, motion: 'no-preference' });
    await page.locator('#month-cats > summary').tap();
    await page.locator('#month-cats > summary').tap();
    await page.evaluate(() => window.scrollTo(0, 400));
    await sleep(600);
    const ok = await page.evaluate(() => [...document.querySelectorAll('#tx-list .tx-row')].every((r) => { const t = getComputedStyle(r).transform; return t === 'none' || /matrix\(1, 0, 0, [0-9.]+, 0, -?[0-9.]+\)/.test(t); }));
    expect(ok).toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe('U6 다시 시도', () => {
  test('UX-24 기록 탭 월 요청 500 -> 문구+다시 시도, 풀고 누르면 목록, 버튼 숨김, 포커스 #month-title-h', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { prepare: (a) => mkTxs(a, 3) });
    let fail = true;
    await page.route('**/api/transactions?month=*', (r) => (fail ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) }) : r.continue()));
    await page.reload();
    await expect(page.locator('#month-error')).not.toBeEmpty();
    await expect(page.locator('#month-retry')).toBeVisible();
    fail = false;
    await page.locator('#month-retry').click();
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await expect(page.locator('#month-retry')).toBeHidden();
    await expect(page.locator('#month-error')).toBeEmpty();
    expect((await active(page)).id).toBe('month-title-h');
  });

  const API = { ins: '/api/insights', monthly: '/api/stats/monthly', cat: '/api/stats/categories', trend: '/api/stats/category-monthly' };
  const count = (reqs, p) => reqs.filter((r) => r.startsWith(`GET ${p}`)).length;
  const prep = async (a) => { await mkTxs(a, 6); await mkTxs(a, 4, '2026-09'); };

  test('UX-25 두 요청 실패 -> 하나의 문구와 다시 시도, 누르면 실패한 두 요청만, 성공하면 숨김', async ({ browser }, testInfo) => {
    const { page, reqs } = await open(browser, testInfo, { prepare: prep, hash: '#record' });
    let fail = true;
    for (const p of [API.ins, API.monthly]) await page.route(`**${p}*`, (r) => (fail ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) }) : r.continue()));
    await page.locator('#tab-dashboard').click();
    await expect(page.locator('#dash-retry')).toBeVisible();
    await expect(page.locator('#dash-error')).toContainText(/^일부 내용을 불러오지 못했어요\. /);
    expect(await page.locator('#dash-error').evaluate((e) => e.textContent.match(/일부 내용/g).length)).toBe(1);
    await expect(page.locator('#kpi')).toBeVisible();
    fail = false;
    const before = Object.fromEntries(Object.entries(API).map(([k, p]) => [k, count(reqs, p)]));
    await page.locator('#dash-retry').click();
    await expect(page.locator('#dash-retry')).toBeHidden();
    await expect(page.locator('#dash-error')).toBeEmpty();
    const d = Object.fromEntries(Object.entries(API).map(([k, p]) => [k, count(reqs, p) - before[k]]));
    expect(d).toEqual({ ins: 1, monthly: 1, cat: 0, trend: 0 });
  });

  test('UX-26 실패 1개는 그 문구만, 달 이동 후 성공하면 문구 없음, 다시 시도로 그린 카드에 data-motion 없음', async ({ browser }, testInfo) => {
    const { page } = await open(browser, testInfo, { prepare: prep, motion: 'no-preference' });
    let fail = true;
    await page.route(`**${API.monthly}*`, (r) => (fail ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) }) : r.continue()));
    await page.locator('#tab-dashboard').click();
    await expect(page.locator('#dash-retry')).toBeVisible();
    const one = await page.locator('#dash-error').innerText();
    expect(one).not.toContain('일부 내용');
    expect(one.length).toBeGreaterThan(0);
    fail = false;
    await page.locator('#dash-retry').click();
    await expect(page.locator('#dash-retry')).toBeHidden();
    await expect(page.locator('#chart-monthly svg, #chart-monthly *').first()).toBeVisible();
    await sleep(200);
    expect(await page.locator('#kpi').getAttribute('data-motion')).toBeNull();
    expect(await page.locator('#chart-monthly').getAttribute('data-motion')).toBeNull();
    // 실패 뒤 달 이동으로 모두 성공
    fail = true;
    await page.locator('#dash-prev').click();
    await expect(page.locator('#dash-retry')).toBeVisible();
    fail = false;
    await page.locator('#dash-prev').click();
    await expect(page.locator('#dash-retry')).toBeHidden();
    await expect(page.locator('#dash-error')).toBeEmpty();
  });
});

test.describe('U4 manifest / U9 이메일', () => {
  const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
  test('UX-27 manifest.json, 아이콘 200 image/png 실제 크기, 두 HTML 의 link/meta', async ({ browser, request }, testInfo) => {
    onlyMobile(testInfo);
    const res = await request.get('/manifest.json');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.name).toBe('가계부');
    const want = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']];
    for (const [sz, purpose] of want) {
      const ic = m.icons.find((i) => i.sizes === sz && (i.purpose || 'any') === purpose);
      expect(ic, `${sz} ${purpose}`).toBeTruthy();
      const r = await request.get(new URL(ic.src, 'http://x/').pathname);
      expect(r.status(), ic.src).toBe(200);
      expect(r.headers()['content-type']).toContain('image/png');
      const { w, h } = pngSize(await r.body());
      expect(`${w}x${h}`, ic.src).toBe(sz);
    }
    for (const path of ['/index.html', '/login.html']) {
      const html = await (await request.get(path)).text();
      expect(html, path).toMatch(/<link rel="manifest" href="manifest\.json">/);
      expect(html, path).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{3,8}">/);
      const ap = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
      expect(ap, path).toBeTruthy();
      const r = await request.get('/' + ap[1]);
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toContain('image/png');
      expect(pngSize(await r.body())).toEqual({ w: 180, h: 180 });
      // 상대 경로로 login.html 에서도 같은 위치
    }
  });

  test('UX-28 theme-color 가 모드 배경색과 같음(전환·새로고침), CSP 위반 0, icons 파일 수 유지', async ({ browser }, testInfo) => {
    const { page, problems } = await open(browser, testInfo);
    const read = () => page.evaluate(() => ({ meta: document.querySelector('meta[name=theme-color]').content, bg: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(), th: document.documentElement.getAttribute('data-theme') }));
    await page.waitForLoadState('load');
    await expect.poll(async () => { const r = await read(); return r.meta === r.bg; }).toBe(true);
    const light = await read();
    await page.locator('#theme-toggle').click();
    const t1 = await read();
    // 토글이 라이트->다크 or 자동->... 모드가 바뀔 때까지 최대 3번
    let cur = t1;
    for (let i = 0; i < 3 && cur.th !== 'dark'; i++) { await page.locator('#theme-toggle').click(); cur = await read(); }
    expect(cur.th).toBe('dark');
    expect(cur.meta).toBe(cur.bg);
    expect(cur.meta).not.toBe(light.meta);
    await page.reload();
    await expect(page.locator('#user-name')).toBeVisible();
    await expect.poll(async () => { const r = await read(); return r.meta === r.bg && r.th === 'dark'; }).toBe(true);
    expect(problems).toEqual([]);
    const tracked = execFileSync('git', ['ls-tree', '--name-only', 'HEAD', 'src/frontend/public/icons/'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').length;
    expect(readdirSync(join(PUBLIC, 'icons')).length).toBe(tracked);
  });

  test('UX-29 64자 이메일: 말줄임 아님, 전체 표시, 가로 스크롤 없음', async ({ browser }, testInfo) => {
    const email = `${`u${Date.now()}${Math.floor(Math.random() * 1e6)}`.padEnd(52, 'x')}@example.com`;
    expect(email.length).toBe(64);
    const api = await newApi();
    const res = await signup(api, { email, password: PASSWORD, name: '이름' });
    expect(res.status()).toBe(201);
    const { page } = await open(browser, testInfo, { user: { api }, hash: '#account' });
    await expect(page.locator('#account-email')).toHaveText(email);
    const m = await page.locator('#account-email').evaluate((e) => ({ to: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace, sw: e.scrollWidth, cw: e.clientWidth, doc: document.documentElement.scrollWidth, vw: innerWidth }));
    expect(m.to).not.toBe('ellipsis');
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.doc).toBeLessThanOrEqual(m.vw);
  });
});

test.describe('회귀', () => {
  test('UX-31 변경 파일이 금지 영역(backend, api.md, vercel.json, schema.sql, tokens/components.css, spring/motion.js)에 없음', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
    const files = out.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
    const banned = files.filter((f) => /^src\/backend\//.test(f) || /(^|\/)docs\/api\.md$/.test(f) || /vercel\.json$/.test(f) || /schema\.sql$/.test(f) || /css\/(tokens|components)\.css$/.test(f) || /js\/lib\/(spring|motion)\.js$/.test(f));
    // plan-category-color: 카테고리 색 기능의 변경 파일은 ux1 금지 영역 검사에서 제외한다
    const COLOR_FILES = /^(docs\/api\.md|src\/backend\/(categories\/routes\.js|lib\/categories\.js|db\/schema\.sql|test\/categories\.test\.js|test\/category-color\.test\.js)|src\/frontend\/public\/css\/(tokens|components)\.css)$/;
    expect(banned.filter((f) => !COLOR_FILES.test(f))).toEqual([]);
    const allowed = /^(src\/frontend\/(public\/|test\/)|e2e\/|docs\/|design_handoff_moneybook\/|README\.md$)/;
    expect(files.filter((f) => !allowed.test(f) && !COLOR_FILES.test(f))).toEqual([]);
  });
});
