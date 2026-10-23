// docs/plan-followup.md 13장(후속 2단계) Q-S2: C-S1~C-S23 신규 검증.
// 남은 돈 비율(C-S1~S2), 저장·수정 되돌리기(C-S3~S10), 수입 인사이트 I1·I2(C-S11~S14), 화면 모드 OS 변경(C-S17), 정적(C-S20, S22, S23).
// 화면 모드 2상태의 나머지(C-S15, S16, S18, S19)는 theme-name.spec.js 를 2상태로 고쳐 확인한다.
// UI "오늘"은 2026-10-19 고정(ctx.clock). API 시험은 today 파라미터로 날짜를 맞춘다.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, json, createLoggedInUser, addTx } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll, FIXED_TODAY } from '../helpers/ui.js';
import { startServer, migrate, tmpPgliteDir, removeDir, checkoutCommit, removeCheckout, allocPort } from '../helpers/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const onlyMobile = (testInfo) => test.skip(widthOf(testInfo) !== 360, 'API/정적 검사는 mobile-360 에서만');

const LIGHT_BG = 'rgb(247, 245, 240)';
const DARK_BG = 'rgb(20, 20, 18)';

const income = (api, category, amount, date, memo = '') => addTx(api, { type: 'income', category, amount, date, memo });
const expense = (api, category, amount, date, memo = '') => addTx(api, { type: 'expense', category, amount, date, memo });
const monthTxs = async (api, month) => (await (await get(api, `/api/transactions?month=${month}`)).json()).transactions;
const insights = async (api, month, today) => {
  const r = await get(api, `/api/insights?month=${month}&today=${today}`);
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
};
const mkCat = async (api, type, name) => {
  const r = await json(api, 'POST', '/api/categories', { type, name });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
};
const setActive = async (api, type, name, active) => {
  const items = (await (await get(api, '/api/categories')).json()).items;
  const it = items.find((i) => i.type === type && i.name === name);
  const r = await json(api, 'PATCH', `/api/categories/${it.id}`, { active });
  expect(r.status(), await r.text()).toBe(200);
};

/** 로그인한 새(또는 지정) 사용자로 앱 열기. confirm 은 수락, 콘솔 오류·CSP 위반 수집. */
async function openApp(browser, testInfo, { prepare, hash = '#record', scheme = 'light', user, stored } = {}) {
  const u = user || await createLoggedInUser('s2');
  if (prepare) await prepare(u.api, u);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  page.removeAllListeners('dialog');
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push({ type: d.type(), message: d.message() }); if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript((v) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (v) { try { localStorage.setItem('mb-theme', v); } catch { /* 무시 */ } }
  }, stored ?? null);
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toHaveText(u.account.name);
  return { ...ui, ...u, dialogs, problems };
}
const csp = (page) => page.evaluate(() => window.__csp || []);
const chip = (page, name) => page.locator('#category-chips button', { hasText: name }).first();
const waitChips = (page) => expect(page.locator('#category-chips button').first()).toBeVisible();
const UNDO = '#flash-undo';
const activeId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
const isPost = (r) => r.request().method() === 'POST' && /\/api\/transactions$/.test(new URL(r.url()).pathname);

/** UI 로 지출 저장 (카테고리 칩 → 금액 → 메모 → 저장). 201 응답의 거래 객체 반환 */
async function saveExpense(page, { category = '식비', amount = '12345', memo = '' } = {}) {
  await chip(page, category).click();
  await page.locator('#amount').fill(amount);
  if (memo) await page.locator('#memo').fill(memo);
  const [resp] = await Promise.all([page.waitForResponse(isPost), page.locator('#save-btn').click()]);
  expect(resp.status()).toBe(201);
  return resp.json();
}
const flashText = (page) => page.locator('#flash');

// ====================================================================== C-S1~S2 남은 돈 비율
test.describe('C-S1/C-S2 남은 돈 비율', () => {
  test('C-S1 문구 4경우 + 같은 값 + 소수 반올림, 달 이동 시 값 갱신, 줄 위치·색, NaN 없음 (라이트·다크)', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const u = await createLoggedInUser('s2rate');
    // 10월: 수입 2,000,000 지출 1,350,000 -> 32.5%   9월: 수입 1,000,000 지출 1,200,000 -> 20.0% 많음
    // 8월: 수입 0 지출 > 0   7월: 둘 다 0(없음)   6월: 수입 = 지출   5월: 지출 1원 수입 3원 -> 33.3%  4월: 수입 1원 지출 1억 -> 큰 비율
    await income(u.api, '급여', 2_000_000, '2026-10-05'); await expense(u.api, '식비', 1_350_000, '2026-10-06');
    await income(u.api, '급여', 1_000_000, '2026-09-05'); await expense(u.api, '식비', 1_200_000, '2026-09-06');
    await expense(u.api, '식비', 50_000, '2026-08-06');
    await income(u.api, '급여', 700_000, '2026-06-05'); await expense(u.api, '식비', 700_000, '2026-06-06');
    await income(u.api, '급여', 3, '2026-05-05'); await expense(u.api, '식비', 2, '2026-05-06');
    await income(u.api, '급여', 1, '2026-04-05'); await expense(u.api, '식비', 100_000_000, '2026-04-06');
    for (const scheme of ['light', 'dark']) {
      const a = await openApp(browser, testInfo, { user: u, scheme, hash: '#dashboard' });
      const { page } = a;
      await expect(page.locator('#kpi .kpi')).toHaveCount(3);
      const rate = page.locator('#kpi .kpi--balance .balance-rate');
      const goPrev = async () => { await page.locator('#dash-prev').click(); await expect(page.locator('#kpi .kpi--balance')).toBeVisible(); };
      await expect(rate).toHaveText('수입의 32.5%가 남았어요');
      // 위치: .kpi--balance 안, 남은 돈 금액 바로 아래, 수입·지출 칸(.kpi-extra) 2개는 그대로
      const pos = await page.locator('#kpi .kpi--balance').evaluate((b) => {
        const kids = [...b.children].map((c) => c.className);
        const v = b.querySelector('.kpi-value'); const r = b.querySelector('.balance-rate');
        return { kids, adjacent: v.nextElementSibling === r, vBottom: v.getBoundingClientRect().bottom, rTop: r.getBoundingClientRect().top, extras: document.querySelectorAll('#kpi .kpi-extra').length, rateInExtra: r.classList.contains('kpi-extra') };
      });
      expect(pos.adjacent, JSON.stringify(pos)).toBe(true);
      expect(pos.rTop).toBeGreaterThanOrEqual(pos.vBottom - 1);
      expect(pos.extras, '.kpi-extra 는 수입·지출 두 칸').toBe(2);
      expect(pos.rateInExtra).toBe(false);
      // 색: 보조 글자색(--color-text-muted), 빨강·초록(수입/지출 색)이 아님, 배경 대비 4.5:1
      const col = await page.evaluate(() => {
        const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const r = document.querySelector('#kpi .balance-rate');
        const muted = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim();
        const probe = document.createElement('i'); probe.style.color = muted; document.body.appendChild(probe);
        const mutedRgb = getComputedStyle(probe).color; probe.remove();
        let bgEl = r; let bg = 'rgba(0, 0, 0, 0)';
        while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(bgEl).backgroundColor; bgEl = bgEl.parentElement; }
        const [x, y] = [lum(parse(getComputedStyle(r).color)), lum(parse(bg))].sort((m, n) => n - m);
        const inc = getComputedStyle(document.querySelector('#kpi .kpi--income .kpi-value')).color;
        const exp = getComputedStyle(document.querySelector('#kpi .kpi--expense .kpi-value')).color;
        return { color: getComputedStyle(r).color, mutedRgb, bg, ratio: (x + 0.05) / (y + 0.05), inc, exp };
      });
      expect(col.color, `${scheme} ${JSON.stringify(col)}`).toBe(col.mutedRgb);
      expect(col.color).not.toBe(col.inc);
      expect(col.color).not.toBe(col.exp);
      expect(col.ratio, `${scheme} 대비 ${JSON.stringify(col)}`).toBeGreaterThanOrEqual(4.5);
      await goPrev();
      await expect(rate).toHaveText('지출이 수입보다 20.0% 많아요'); // 9월
      await goPrev();
      await expect(rate).toHaveText('수입 기록이 없어 비율을 계산하지 않아요'); // 8월
      await goPrev();
      await expect(page.locator('#kpi .balance-rate')).toHaveCount(0); // 7월 둘 다 0
      await expect(page.locator('#kpi .kpi--balance .kpi-value')).toHaveText('0원');
      await goPrev();
      await expect(rate).toHaveText('수입의 0.0%가 남았어요'); // 6월 수입 = 지출
      await goPrev();
      await expect(rate).toHaveText('수입의 33.3%가 남았어요'); // 5월: 수입 3 지출 2 -> 남은 돈 1
      await goPrev();
      await expect(rate).toHaveText('지출이 수입보다 9,999,999,900.0% 많아요'); // 4월 수입 1원 지출 1억 원
      console.log(`BIGRATE ${await rate.innerText()}`);
      expect(await page.locator('#kpi').innerText()).not.toMatch(/NaN|undefined|Infinity/);
      await expectNoHorizontalScroll(page, widthOf(testInfo));
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });
});

// ====================================================================== C-S3~S10 되돌리기
test.describe('C-S3~S10 저장·수정 되돌리기', () => {
  test('C-S3/C-S9 저장 뒤: 글자는 "저장했어요", 버튼 이름·44px·live 영역 밖, 포커스는 금액칸, 누르면 사라지고 서버 404', async ({ browser }, testInfo) => {
    const a = await openApp(browser, testInfo);
    const { page, api } = a;
    await waitChips(page);
    const tx = await saveExpense(page, { amount: '12345', memo: '되돌리기 시험' });
    await expect(flashText(page)).toHaveText('저장했어요');
    const btn = page.getByRole('button', { name: '방금 저장한 기록 되돌리기' });
    await expect(btn).toBeVisible();
    expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await btn.innerText()).toBe('되돌리기'); // WCAG 2.5.3: 이름이 보이는 글자를 포함
    expect(await activeId(page), '저장 뒤 포커스').toBe('amount');
    const live = await page.evaluate(() => ({
      flashHasButton: !!document.querySelector('#flash button'),
      undoInLive: !!document.querySelector('#flash-undo').closest('[aria-live],[role=status],[role=alert]'),
      flashRole: document.querySelector('#flash').getAttribute('role'),
    }));
    expect(live).toEqual({ flashHasButton: false, undoInLive: false, flashRole: 'status' });
    await expect(page.locator('#tx-list')).toContainText('되돌리기 시험');
    await expect(page.locator('#month-totals')).toContainText('12,345');
    await btn.click();
    await expect(flashText(page)).toHaveText('되돌렸어요');
    await expect(page.locator(UNDO)).toBeHidden();
    await expect(page.locator('#tx-list')).not.toContainText('되돌리기 시험');
    await expect(page.locator('#month-totals')).not.toContainText('12,345');
    const sum = await (await get(api, '/api/summary?month=2026-10')).json();
    expect(sum.expenseTotal).toBe(0);
    expect((await monthTxs(api, '2026-10')).some((t) => t.id === tx.id)).toBe(false);
    expect((await json(api, 'DELETE', `/api/transactions/${tx.id}`)).status(), '서버에서 그 id 는 404').toBe(404);
    // 대시보드·인사이트에서도 사라짐
    await page.locator('a[href="#dashboard"], .tabbar__item[href="#dashboard"]').first().click();
    await expect(page.locator('#kpi .kpi--balance .kpi-value')).toHaveText('0원');
    const ins = await insights(api, '2026-10', FIXED_TODAY);
    expect(ins.largeExpenses).toEqual([]);
    expect(await csp(page)).toEqual([]);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-S4 수정(금액·메모·날짜·다른 달 날짜·카테고리·유형) 뒤 되돌리기: 수정 전 값 전부, createdAt·목록 순서 같음, 수정 전 날짜의 달로 이동', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const u = await createLoggedInUser('s2edit');
    const cases = [
      ['amount', async (page) => { await page.locator('#amount').fill('777'); }],
      ['memo', async (page) => { await page.locator('#memo').fill('바뀐 메모'); }],
      ['date 같은 달', async (page) => { await page.locator('#date-details summary').click(); await page.locator('#date').fill('2026-10-03'); }],
      ['date 다른 달', async (page) => { await page.locator('#date-details summary').click(); await page.locator('#date').fill('2026-09-15'); }],
      ['category', async (page) => { await chip(page, '교통').click(); }],
      ['type', async (page) => { await page.locator('#type-income').click(); await chip(page, '급여').click(); }],
    ];
    const a = await openApp(browser, testInfo, { user: u });
    const { page, api } = a;
    for (const [label, mutate] of cases) {
      const memo = `원본-${label}`;
      const r = await expense(api, '식비', 4000, '2026-10-10', memo);
      const orig = await r.json();
      await expense(api, '식비', 1100, '2026-10-10', `뒤-${label}`); // 같은 날 더 늦게 만든 거래 (순서 확인용)
      const orderBefore = (await monthTxs(api, '2026-10')).map((t) => t.id);
      await page.reload();
      await expect(page.locator('#tx-list')).toContainText(memo);
      const titleBefore = await page.locator('#month-title-h').innerText();
      await page.locator('#tx-list .tx-edit', { hasText: memo }).click();
      await mutate(page);
      const [resp] = await Promise.all([
        page.waitForResponse((x) => x.request().method() === 'PUT'),
        page.locator('#save-btn').click(),
      ]);
      expect(resp.status(), label).toBe(200);
      await expect(flashText(page), label).toHaveText('수정했어요');
      const btn = page.getByRole('button', { name: '방금 수정한 내용 되돌리기' });
      await expect(btn, label).toBeVisible();
      await btn.click();
      await expect(flashText(page), label).toHaveText('되돌렸어요');
      const back = (await monthTxs(api, '2026-10')).find((t) => t.id === orig.id);
      expect(back, `${label} 원래 달에 거래가 돌아옴`).toBeTruthy();
      expect({ type: back.type, amount: back.amount, category: back.category, memo: back.memo, date: back.date, createdAt: back.createdAt }, label)
        .toEqual({ type: orig.type, amount: orig.amount, category: orig.category, memo: orig.memo, date: orig.date, createdAt: orig.createdAt });
      expect((await monthTxs(api, '2026-10')).map((t) => t.id), `${label} 목록 순서`).toEqual(orderBefore);
      expect((await monthTxs(api, '2026-09')).some((t) => t.id === orig.id), `${label} 9월에는 없음`).toBe(false);
      await expect(page.locator('#month-title-h'), `${label} 화면이 수정 전 달`).toHaveText(titleBefore);
      await expect(page.locator('#tx-list')).toContainText(memo);
    }
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-S5 사용 안 함 카테고리 거래: 다른 카테고리로 고치면 버튼 없음, 같은 카테고리에서 금액만 고치면 버튼 있고 되돌리기 200', async ({ browser }, testInfo) => {
    const ids = {};
    const a = await openApp(browser, testInfo, {
      prepare: async (api) => {
        await mkCat(api, 'expense', '경조사');
        ids.a = (await (await expense(api, '경조사', 50_000, FIXED_TODAY, '축의금A')).json()).id;
        ids.b = (await (await expense(api, '경조사', 30_000, FIXED_TODAY, '축의금B')).json()).id;
        await setActive(api, 'expense', '경조사', false);
      },
    });
    const { page, api } = a;
    await waitChips(page);
    // 다른 카테고리로 고침 -> 버튼 없이 글자만
    await page.locator('#tx-list .tx-edit', { hasText: '축의금A' }).click();
    await chip(page, '식비').click();
    await page.locator('#save-btn').click();
    await expect(flashText(page)).toHaveText('수정했어요');
    await expect(page.locator(UNDO)).toBeHidden();
    expect((await monthTxs(api, '2026-10')).find((t) => t.id === ids.a).category).toBe('식비');
    // 같은 카테고리에서 금액만 고침 -> 버튼 있음, 되돌리기 성공(PUT 200)
    await page.locator('#tx-list .tx-edit', { hasText: '축의금B' }).click();
    await page.locator('#amount').fill('99000');
    await page.locator('#save-btn').click();
    await expect(flashText(page)).toHaveText('수정했어요');
    await expect(page.locator(UNDO)).toBeVisible();
    const [put] = await Promise.all([page.waitForResponse((x) => x.request().method() === 'PUT'), page.locator(UNDO).click()]);
    expect(put.status()).toBe(200);
    await expect(flashText(page)).toHaveText('되돌렸어요');
    const b = (await monthTxs(api, '2026-10')).find((t) => t.id === ids.b);
    expect({ amount: b.amount, category: b.category }).toEqual({ amount: 30_000, category: '경조사' });
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-S6 삭제 뒤에는 "삭제했어요" 만, 되돌리기 버튼 없음', async ({ browser }, testInfo) => {
    const a = await openApp(browser, testInfo, { prepare: async (api) => { await expense(api, '식비', 3000, FIXED_TODAY, '지울것'); } });
    const { page } = a;
    await expect(page.locator('#tx-list')).toContainText('지울것');
    await page.locator('#tx-list .tx-del').first().click();
    await expect(flashText(page)).toHaveText('삭제했어요');
    await expect(page.locator(UNDO)).toBeHidden();
    expect(await page.locator(UNDO).evaluate((e) => e.hidden)).toBe(true);
    await a.ctx.close();
  });

  test('C-S7 시간: 버튼 토스트 약 5초, 글자만 약 4초, 포인터·포커스 중에는 유지되고 벗어나면 다시 5초', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const a = await openApp(browser, testInfo);
    const { page } = a;
    await waitChips(page);
    const gone = async (t0, max = 9000) => { await expect(flashText(page)).toHaveText('', { timeout: max }); return Date.now() - t0; };
    // 1) 그냥 두기: 약 5초
    await saveExpense(page, { amount: '1000' });
    await expect(page.locator(UNDO)).toBeVisible();
    let t0 = Date.now();
    const plain = await gone(t0);
    expect(plain, `버튼 토스트 ${plain}ms`).toBeGreaterThanOrEqual(4300);
    expect(plain).toBeLessThanOrEqual(6300);
    await expect(page.locator(UNDO)).toBeHidden();
    // 2) 글자만 토스트(되돌렸어요): 약 4초
    await saveExpense(page, { amount: '1100' });
    await page.locator(UNDO).click();
    await expect(flashText(page)).toHaveText('되돌렸어요');
    t0 = Date.now();
    const textOnly = await gone(t0);
    expect(textOnly, `글자만 토스트 ${textOnly}ms`).toBeGreaterThanOrEqual(3300);
    expect(textOnly).toBeLessThanOrEqual(5300);
    // 3) 포인터를 올려 두면 5초가 지나도 남고, 벗어나면 다시 5초
    await saveExpense(page, { amount: '1200' });
    const box = await page.locator('#toast').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(6500);
    await expect(page.locator(UNDO)).toBeVisible();
    await expect(flashText(page)).toHaveText('저장했어요');
    await page.mouse.move(5, 500);
    t0 = Date.now();
    const afterHover = await gone(t0);
    expect(afterHover, `포인터 이탈 후 ${afterHover}ms`).toBeGreaterThanOrEqual(4300);
    expect(afterHover).toBeLessThanOrEqual(6300);
    // 4) 포커스가 버튼에 있으면 유지, 벗어나면 다시 5초
    await saveExpense(page, { amount: '1300' });
    await page.locator(UNDO).focus();
    await page.waitForTimeout(6500);
    await expect(page.locator(UNDO)).toBeVisible();
    await page.locator('#memo').focus();
    t0 = Date.now();
    const afterBlur = await gone(t0);
    expect(afterBlur, `포커스 이탈 후 ${afterBlur}ms`).toBeGreaterThanOrEqual(4300);
    expect(afterBlur).toBeLessThanOrEqual(6300);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-S8 경합: 두 번 눌러도 요청 1번, 진행 중 저장 Enter 무시, 새 저장·수정 시작·삭제 시 이전 버튼 사라짐', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const a = await openApp(browser, testInfo, { prepare: async (api) => { await expense(api, '교통', 2000, FIXED_TODAY, '기존'); } });
    const { page, api } = a;
    await waitChips(page);
    const reqs = [];
    page.on('request', (r) => { if (/\/api\/transactions/.test(r.url())) reqs.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/, ':id')}`); });
    // 1) 느린 DELETE 를 두 번 클릭 + 진행 중 저장 Enter
    await page.route('**/api/transactions/*', async (route) => {
      if (route.request().method() === 'DELETE') await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const tx1 = await saveExpense(page, { amount: '5000', memo: '경합1' });
    reqs.length = 0;
    await page.locator(UNDO).dblclick();
    await expect(page.locator(UNDO)).toBeDisabled(); // 진행 중에는 disabled
    await page.locator('#amount').fill('7000');
    await page.locator('#amount').press('Enter'); // 진행 중 저장 제출 무시
    await expect(flashText(page)).toHaveText('되돌렸어요', { timeout: 6000 });
    expect(reqs.filter((x) => x.startsWith('DELETE')), reqs.join(' | ')).toHaveLength(1);
    expect(reqs.filter((x) => x.startsWith('POST')), '진행 중 저장 요청 없음: ' + reqs.join(' | ')).toHaveLength(0);
    expect((await monthTxs(api, '2026-10')).some((t) => t.id === tx1.id)).toBe(false);
    await page.unroute('**/api/transactions/*');
    await page.locator('#amount').fill('');
    // 2) 새 저장: 이전 버튼은 새 기록의 것으로 교체 -> 누르면 새 기록만 사라진다
    const txA = await saveExpense(page, { amount: '1111', memo: '저장A' });
    const txB = await saveExpense(page, { amount: '2222', memo: '저장B' });
    await page.locator(UNDO).click();
    await expect(flashText(page)).toHaveText('되돌렸어요');
    const ids = (await monthTxs(api, '2026-10')).map((t) => t.id);
    expect(ids).toContain(txA.id);
    expect(ids).not.toContain(txB.id);
    // 3) 목록에서 수정 시작 -> 버튼 사라짐
    await saveExpense(page, { amount: '3333', memo: '저장C' });
    await expect(page.locator(UNDO)).toBeVisible();
    await page.locator('#tx-list .tx-edit', { hasText: '기존' }).click();
    await expect(page.locator(UNDO)).toBeHidden();
    await page.locator('#cancel-edit-btn').click();
    // 4) 삭제 -> 버튼 사라짐
    await saveExpense(page, { amount: '4444', memo: '저장D' });
    await expect(page.locator(UNDO)).toBeVisible();
    await page.locator('#tx-list .tx-del', { hasText: '삭제' }).first().click();
    await expect(flashText(page)).toHaveText('삭제했어요');
    await expect(page.locator(UNDO)).toBeHidden();
    // 5) 다른 탭(API)에서 먼저 지운 거래: 생성 되돌리기는 성공(404 허용)
    const txE = await saveExpense(page, { amount: '5555', memo: '저장E' });
    expect((await json(api, 'DELETE', `/api/transactions/${txE.id}`)).status()).toBe(204);
    await page.locator(UNDO).click();
    await expect(flashText(page)).toHaveText('되돌렸어요');
    // 6) 수정 되돌리기 전에 지워진 거래: 전용 문구
    const base = await (await expense(api, '식비', 6000, FIXED_TODAY, '수정대상')).json();
    await page.reload();
    await page.locator('#tx-list .tx-edit', { hasText: '수정대상' }).click();
    await page.locator('#amount').fill('6500');
    await page.locator('#save-btn').click();
    await expect(flashText(page)).toHaveText('수정했어요');
    expect((await json(api, 'DELETE', `/api/transactions/${base.id}`)).status()).toBe(204);
    await page.locator(UNDO).click();
    await expect(flashText(page)).toHaveText('이미 삭제된 기록이라 되돌리지 못했어요');
    await expect(page.locator(UNDO)).toBeHidden();
    // 7) 서버 오류: 일반 실패 문구
    await saveExpense(page, { amount: '7777', memo: '저장F' });
    await page.route('**/api/transactions/*', (route) => (route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '서버 오류' } }) })
      : route.continue()));
    await page.locator(UNDO).click();
    await expect(flashText(page)).toHaveText('되돌리지 못했어요. 목록에서 직접 고쳐 주세요.');
    expect(await csp(page)).toEqual([]);
    expect(a.problems.filter((p) => !/500|Failed to load resource/.test(p))).toEqual([]);
    await a.ctx.close();
  });

  test('재검증 저장 직후 즉시 되돌리기(목록 새로고침 중에도 동작), 되돌리기 요청 중 목록에서 수정 시작은 무시', async ({ browser }, testInfo) => {
    const a = await openApp(browser, testInfo, { prepare: async (api) => { await expense(api, '교통', 2000, FIXED_TODAY, '기존'); } });
    const { page, api } = a;
    await waitChips(page);
    // 느리게 만들 요청을 플래그로 제어한다(핸들러는 하나, unroute 없음)
    const slow = { list: true, del: false };
    await page.route('**/api/transactions*', async (route) => {
      const r = route.request();
      const isList = r.method() === 'GET';
      const isDel = r.method() === 'DELETE';
      if ((isList && slow.list) || (isDel && slow.del)) await new Promise((x) => setTimeout(x, isDel ? 1500 : 1200));
      await route.continue().catch(() => {});
    });
    const tx = await saveExpense(page, { amount: '4200', memo: '즉시' });
    await page.locator(UNDO).click({ timeout: 2000 }); // 목록 새로고침이 끝나기 전에 누른다
    await expect(flashText(page)).toHaveText('되돌렸어요', { timeout: 8000 });
    expect((await monthTxs(api, '2026-10')).some((t) => t.id === tx.id)).toBe(false);
    slow.list = false; slow.del = true;
    await saveExpense(page, { amount: '4300', memo: '진행중' });
    await page.locator(UNDO).click();
    await page.locator('#tx-list .tx-edit', { hasText: '기존' }).click({ force: true });
    expect(await page.locator('#cancel-edit-btn').isVisible(), '수정 모드로 들어가지 않음').toBe(false);
    await expect(flashText(page)).toHaveText('되돌렸어요', { timeout: 8000 });
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-S9 키보드: Tab 으로 도달·포커스 링, Enter/Space 로 되돌리기, 포커스가 있으면 끝난 뒤 금액칸으로(body 아님), 라이트·다크 대비 4.5:1', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    for (const scheme of ['light', 'dark']) {
      const a = await openApp(browser, testInfo, { scheme });
      const { page } = a;
      await waitChips(page);
      for (const key of ['Enter', 'Space']) {
        const tx = await saveExpense(page, { amount: '2500', memo: `키보드${key}` });
        expect(await activeId(page)).toBe('amount');
        await page.locator('#user-name').focus();
        let reached = false;
        for (let i = 0; i < 8 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await activeId(page)) === 'flash-undo'; }
        expect(reached, `${scheme} Tab 으로 되돌리기 버튼 도달`).toBe(true);
        const ring = await page.locator(UNDO).evaluate((e) => { const cs = getComputedStyle(e); return { visible: e.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth}`, color: cs.color }; });
        expect(ring.visible).toBe(true);
        expect(ring.outline, '포커스 링').toMatch(/solid [1-9]/);
        await page.waitForTimeout(300);
        await page.keyboard.press(key);
        await expect(flashText(page)).toHaveText('되돌렸어요');
        expect(await activeId(page), `${scheme} ${key} 뒤 포커스`).toBe('amount');
        expect((await monthTxs(a.api, '2026-10')).some((t) => t.id === tx.id)).toBe(false);
      }
      // 대비: 버튼 글자색 대 토스트 배경색, 토스트 글자 대비
      await saveExpense(page, { amount: '999' });
      const c = await page.evaluate(() => {
        const parse = (x) => x.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const ratio = (f, b) => { const [x, y] = [lum(parse(f)), lum(parse(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        const t = getComputedStyle(document.querySelector('#toast'));
        const b = getComputedStyle(document.querySelector('#flash-undo'));
        const f = getComputedStyle(document.querySelector('#flash'));
        return { btn: ratio(b.color, t.backgroundColor), text: ratio(f.color, t.backgroundColor), border: ratio(b.borderTopColor, t.backgroundColor), bg: t.backgroundColor, btnColor: b.color };
      });
      expect(c.btn, `${scheme} 버튼 글자 대비 ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(4.5);
      expect(c.text, `${scheme} 토스트 글자 대비`).toBeGreaterThanOrEqual(4.5);
      expect(c.border, `${scheme} 버튼 테두리 대비`).toBeGreaterThanOrEqual(3);
      expect(await csp(page)).toEqual([]);
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });

  test('C-S10/배치 토스트: 화면 안, 가로 스크롤 없음, 긴 실패 문구에서도 안 잘림, 헤더와 겹치는 정도 기록', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const a = await openApp(browser, testInfo);
    const { page } = a;
    await waitChips(page);
    await saveExpense(page, { amount: '3000' });
    await expect(page.locator(UNDO)).toBeVisible();
    const m = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      return { toast: r('#toast'), undo: r('#flash-undo'), flash: r('#flash'), header: r('.app-header'), vw: document.documentElement.clientWidth };
    });
    expect(m.toast.l, JSON.stringify(m)).toBeGreaterThanOrEqual(0);
    expect(m.toast.r).toBeLessThanOrEqual(m.vw + 0.5);
    expect(m.undo.r).toBeLessThanOrEqual(m.toast.r + 0.5);
    expect(m.undo.l).toBeGreaterThanOrEqual(m.flash.r - 0.5); // 글자와 버튼이 겹치지 않음
    await expectNoHorizontalScroll(page, w);
    await page.screenshot({ path: join(testInfo.outputDir, `toast-undo-${w}.png`) });
    testInfo.attach(`toast-undo-${w}`, { path: join(testInfo.outputDir, `toast-undo-${w}.png`), contentType: 'image/png' });
    console.log(`TOAST ${w}px toast=${JSON.stringify(m.toast)} header=${JSON.stringify(m.header)} overlapHeader=${m.toast.t < m.header.b}`);
    // 관찰: 페이지 맨 위에서 토스트(fixed, top 16px)가 헤더의 화면 모드·로그아웃 버튼을 얼마나 가리는지 (결함 여부는 reviewer 판단, 여기서는 기록만)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(testInfo.outputDir, 'toast-top-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 160 } });
    const cover = await page.evaluate(() => {
      const t = document.querySelector('#toast').getBoundingClientRect();
      const out = {};
      for (const id of ['theme-toggle', 'logout-btn', 'user-name']) {
        const r = document.getElementById(id).getBoundingClientRect();
        const w = Math.max(0, Math.min(t.right, r.right) - Math.max(t.left, r.left));
        const h = Math.max(0, Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top));
        const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        out[id] = { overlapPx: Math.round(w * h), overlapPct: Math.round((w * h) / (r.width * r.height) * 100), centerCovered: !!(hit && hit.closest('#toast')) };
      }
      return out;
    });
    console.log(`TOAST-COVER ${w}px ${JSON.stringify(cover)}`);
    for (const id of ['theme-toggle', 'logout-btn', 'user-name']) expect(cover[id], `토스트가 #${id} 를 가림 ${JSON.stringify(cover)}`).toEqual({ overlapPx: 0, overlapPct: 0, centerCovered: false });
    // 긴 실패 문구 (버튼 없음): 화면 안에 들어오는지
    await page.route('**/api/transactions/*', (route) => (route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ERROR","message":"x"}}' }) : route.continue()));
    await page.locator(UNDO).click();
    await expect(flashText(page)).toHaveText('되돌리지 못했어요. 목록에서 직접 고쳐 주세요.');
    const m2 = await page.evaluate(() => { const b = document.querySelector('#toast').getBoundingClientRect(); return { l: b.left, r: b.right, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; });
    expect(m2.l).toBeGreaterThanOrEqual(0);
    expect(m2.r).toBeLessThanOrEqual(m2.vw + 0.5);
    expect(m2.sw).toBeLessThanOrEqual(w);
    await a.ctx.close();
  });
});

// ====================================================================== C-S11~S13 수입 인사이트 API
test.describe('C-S11~S13 수입 인사이트 API', () => {
  test('C-S11 I1: 경계 0.8 포함, 2,000,001 제외, 0원, 정렬, 이번 달·미래 달·같은 달 빈 배열, 필드 타입', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const { api } = await createLoggedInUser('s2i1');
    const T = '2026-10-15';
    for (const m of ['06', '07', '08']) {
      await income(api, '급여', 2_500_000, `2026-${m}-05`);
      await income(api, '용돈', 100_000, `2026-${m}-06`);
      await income(api, '부수입', 100_000, `2026-${m}-07`);
    }
    await income(api, '기타', 20_000, '2026-07-20'); await income(api, '기타', 40_000, '2026-08-20'); // k=2, 평균 30,000, 9월 0원
    await income(api, '급여', 2_000_000, '2026-09-05'); // 정확히 0.8
    await income(api, '용돈', 80_000, '2026-09-06'); // 정확히 0.8
    await income(api, '부수입', 80_001, '2026-09-07'); // 경계 바로 위
    const r = await insights(api, '2026-09', T);
    expect(Object.keys(r).sort()).toEqual(['incomeDrops', 'largeExpenses', 'missingIncome', 'month', 'overspending', 'recurring']);
    expect(r.incomeDrops).toEqual([
      { category: '기타', currentTotal: 0, baseline: 30_000, ratio: 0 },
      { category: '급여', currentTotal: 2_000_000, baseline: 2_500_000, ratio: 0.8 },
      { category: '용돈', currentTotal: 80_000, baseline: 100_000, ratio: 0.8 },
    ]);
    for (const d of r.incomeDrops) {
      expect(Number.isInteger(d.currentTotal) && Number.isInteger(d.baseline)).toBe(true);
      expect(typeof d.ratio).toBe('number');
      expect(Math.round(d.ratio * 100) / 100).toBe(d.ratio);
    }
    for (const m of ['2026-10', '2026-11', '2027-03']) expect((await insights(api, m, T)).incomeDrops, `month ${m}`).toEqual([]);
    expect((await insights(api, '2026-09', '2026-09-20')).incomeDrops, '같은 달은 끝난 달이 아님').toEqual([]);
    expect((await insights(api, '2026-09', '2026-10-01')).incomeDrops.length, '다음 달 1일이면 끝난 달').toBe(3);
    // 2,000,001 -> 없음
    const u2 = await createLoggedInUser('s2i1b');
    for (const m of ['06', '07', '08']) await income(u2.api, '급여', 2_500_000, `2026-${m}-05`);
    await income(u2.api, '급여', 2_000_001, '2026-09-05');
    expect((await insights(u2.api, '2026-09', T)).incomeDrops).toEqual([]);
    // baseline 경계와 기록 달 수
    const u3 = await createLoggedInUser('s2i1c');
    for (const m of ['06', '07', '08']) { await income(u3.api, '급여', 9_999, `2026-${m}-05`); await income(u3.api, '용돈', 10_000, `2026-${m}-06`); }
    await income(u3.api, '부수입', 500_000, '2026-08-07'); // 기록 달 1개월
    await income(u3.api, '기타', 9_999, '2026-07-08'); await income(u3.api, '기타', 10_000, '2026-08-08'); // 평균 9,999.5
    const r3 = await insights(u3.api, '2026-09', T);
    expect(r3.incomeDrops).toEqual([{ category: '용돈', currentTotal: 0, baseline: 10_000, ratio: 0 }]);
    // 지출은 대상 아님
    const u4 = await createLoggedInUser('s2i1d');
    for (const m of ['06', '07', '08']) await expense(u4.api, '식비', 200_000, `2026-${m}-05`);
    expect((await insights(u4.api, '2026-09', T)).incomeDrops).toEqual([]);
  });

  test('C-S12 I2: 유예 2일/3일, 이번 달 거래(미리 입력 포함)가 있으면 제외, 마지막+70일 경계, 다른 달·주간·지출·메모 없는 그룹, 사용 안 함·이름 변경', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const { api } = await createLoggedInUser('s2i2');
    // 월간 급여: 6/10, 7/10, 8/9 (간격 30) -> 예상 9/8
    for (const d of ['2026-06-10', '2026-07-10', '2026-08-09']) await income(api, '급여', 2_500_000, d, '급여');
    // 메모 없는 부수입 월간 (카테고리+금액으로 묶임)
    for (const d of ['2026-06-10', '2026-07-10', '2026-08-09']) await income(api, '부수입', 300_000, d, '');
    // 주간 용돈 (대상 아님), 월간 지출 (대상 아님)
    for (let i = 0; i < 8; i++) await income(api, '용돈', 50_000, new Date(Date.UTC(2026, 6, 10 + i * 7)).toISOString().slice(0, 10), '주급');
    for (const d of ['2026-06-10', '2026-07-10', '2026-08-09']) await expense(api, '주거/통신', 500_000, d, '월세');
    const at = async (today, month = today.slice(0, 7)) => (await insights(api, month, today)).missingIncome;
    expect(await at('2026-09-10'), '예상일 +2일 -> 없음').toEqual([]);
    expect(await at('2026-09-08'), '예상일 당일').toEqual([]);
    const hit = await at('2026-09-11');
    expect(hit, '예상일 +3일 -> 있음 (expectedDate 오름차순, 같으면 memo 가나다)').toEqual([
      { memo: '', category: '부수입', amount: 300_000, lastDate: '2026-08-09', expectedDate: '2026-09-08' },
      { memo: '급여', category: '급여', amount: 2_500_000, lastDate: '2026-08-09', expectedDate: '2026-09-08' },
    ]);
    for (const x of hit) { expect(Number.isInteger(x.amount)).toBe(true); expect(x.lastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
    expect((await at('2026-10-18')).map((x) => x.category).sort(), '마지막+70일 당일 -> 있음').toEqual(['급여', '부수입']);
    expect(await at('2026-10-19'), '마지막+70일 다음 날 -> 없음').toEqual([]);
    expect(await at('2026-09-11', '2026-08'), '이번 달이 아닌 달 -> []').toEqual([]);
    expect(await at('2026-09-11', '2026-10'), '다음 달 -> []').toEqual([]);
    // 사용 안 함도 계속 판정, 이름 변경은 메모 없는 그룹이 새 이름으로 이어짐
    await setActive(api, 'income', '급여', false);
    expect((await at('2026-09-11')).map((x) => x.category)).toContain('급여');
    const items = (await (await get(api, '/api/categories')).json()).items;
    const bu = items.find((i) => i.type === 'income' && i.name === '부수입');
    expect((await json(api, 'PATCH', `/api/categories/${bu.id}`, { name: '새수입' })).status()).toBe(200);
    const renamed = await at('2026-09-11');
    expect(renamed.map((x) => `${x.memo}|${x.category}`).sort()).toEqual(['|새수입', '급여|급여']);
    // 이번 달에 같은 그룹 거래가 오늘 이후 날짜로 미리 입력되어 있으면 제외
    await setActive(api, 'income', '급여', true); // 사용 안 함 카테고리에는 새로 입력할 수 없다
    const r = await income(api, '급여', 2_500_000, '2026-09-25', '급여');
    expect(r.status()).toBe(201);
    expect((await at('2026-09-11')).map((x) => x.memo), '미리 입력한 수입이 있는 그룹은 제외').toEqual(['']);
    // 이번 달에 이미 들어온 경우(오늘 이전)
    await income(api, '새수입', 300_000, '2026-09-09', '');
    expect(await at('2026-09-11')).toEqual([]);
  });

  test('C-S13 기존 키 month, recurring, overspending, largeExpenses 가 변경 전(HEAD) 서버와 같다 (같은 데이터, 여러 달·today)', async ({}, testInfo) => {
    onlyMobile(testInfo);
    test.setTimeout(180_000);
    const oldDir = checkoutCommit('5a0689d');
    const dir = tmpPgliteDir();
    let old;
    try {
      migrate(dir, {}, oldDir);
      old = await startServer({ dir, port: allocPort(), cwd: oldDir });
      const mine = await createLoggedInUser('s2reg');
      const theirs = await createLoggedInUser('s2reg', { baseURL: old.url });
      const feed = async (api) => {
        for (const d of ['2026-07-04', '2026-08-03', '2026-09-02', '2026-10-02']) await expense(api, '문화/여가', 17_000, d, '넷플릭스');
        for (const [d, a] of [['2026-06-03', 100_000], ['2026-07-03', 100_000], ['2026-08-03', 110_000], ['2026-09-20', 150_000]]) await expense(api, '식비', a, d, '장보기');
        for (const d of ['2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05', '2026-08-06', '2026-09-08']) await expense(api, '쇼핑', 20_000, d, '잡화');
        await expense(api, '쇼핑', 250_000, '2026-10-12', '패딩');
        for (const d of ['2026-06-25', '2026-07-25', '2026-08-25', '2026-09-25']) await income(api, '급여', 2_500_000, d, '급여');
        await income(api, '용돈', 50_000, '2026-10-01', '');
        await expense(api, '식비', 40_000, '2026-10-05', '외식'); await expense(api, '식비', 30_000, '2026-10-10', '외식');
      };
      await feed(mine.api); await feed(theirs.api);
      const strip = (r) => ({ month: r.month, recurring: r.recurring, overspending: r.overspending, largeExpenses: r.largeExpenses.map(({ transactionId, ...rest }) => rest) }); // transactionId 는 서버마다 다른 UUID
      const cases = [['2026-10', '2026-10-19'], ['2026-09', '2026-10-19'], ['2026-08', '2026-10-19'], ['2026-10', '2026-10-25'], ['2026-10', '2026-11-20'], ['2026-09', '2026-09-15'], ['2026-11', '2026-10-19']];
      let compared = 0;
      for (const [month, today] of cases) {
        const n = await insights(mine.api, month, today);
        const o = await (await get(theirs.api, `/api/insights?month=${month}&today=${today}`)).json();
        expect(Object.keys(o).sort(), '변경 전 서버는 새 키가 없음').toEqual(['largeExpenses', 'month', 'overspending', 'recurring']);
        expect(Object.keys(n).sort()).toEqual(['incomeDrops', 'largeExpenses', 'missingIncome', 'month', 'overspending', 'recurring']);
        expect(strip(n), `${month} @ ${today}`).toEqual(strip(o));
        compared += 1;
      }
      expect(compared).toBe(cases.length);
      // 급여 R3(반복) 항목이 실제로 비교에 들어갔는지(빈 배열끼리 비교가 아님)
      const sample = await insights(mine.api, '2026-10', '2026-10-19');
      expect(sample.recurring.length + sample.overspending.length + sample.largeExpenses.length).toBeGreaterThan(0);
    } finally {
      if (old) await old.stop();
      removeCheckout(oldDir);
      removeDir(dir);
    }
  });
});

// ====================================================================== C-S14 인사이트 화면
test.describe('C-S14 수입 인사이트 화면', () => {
  test('C-S14 섹션 제목·문구·순서, 메모 HTML 은 글자 그대로, 금지어 없음, 지난달 보기에서는 I1 만', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const a = await openApp(browser, testInfo, {
      prepare: async (api) => {
        for (const d of ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05']) await income(api, '급여', 2_500_000, d, '급여');
        for (const d of ['2026-07-15', '2026-08-14', '2026-09-13']) await income(api, '부수입', 400_000, d, '<img src=x onerror=alert(1)>');
        for (const d of ['2026-06-01', '2026-07-01', '2026-08-01']) await income(api, '용돈', 100_000, d);
        await income(api, '용돈', 50_000, '2026-09-01');
        for (const d of ['2026-07-04', '2026-08-03', '2026-09-02', '2026-10-02']) await expense(api, '문화/여가', 17_000, d, '넷플릭스');
      },
    });
    const { page } = a;
    const box = page.locator('#insights');
    await expect(box.locator('.insight-income-missing')).toBeVisible();
    const titles = await box.locator('h3').allTextContents();
    expect(titles).toContain('아직 들어오지 않은 수입');
    expect(titles.indexOf('반복 거래'), `제목 ${titles}`).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf('아직 들어오지 않은 수입')).toBeGreaterThan(titles.indexOf('반복 거래'));
    expect(titles, '이번 달에는 I1 없음').not.toContain('평소보다 적은 수입');
    const missing = await box.locator('.insight-income-missing .insight-text').allTextContents();
    expect(missing).toContain('급여 2,500,000원: 매달 들어오던 수입이 이번 달엔 아직 없어요 (마지막 9월 5일)');
    expect(missing).toContain('<img src=x onerror=alert(1)> 400,000원: 매달 들어오던 수입이 이번 달엔 아직 없어요 (마지막 9월 13일)');
    expect(await box.locator('.insight-income-missing .insight-label').first().innerText()).toBe('아직 없음');
    expect(await box.locator('img').count(), 'HTML 은 요소가 되지 않음').toBe(0);
    expect(a.dialogs.filter((d) => d.type === 'alert')).toEqual([]);
    // 지난달(9월) 보기: I1 만
    await page.locator('#month-prev').click();
    await expect(box.locator('.insight-income-drop')).toBeVisible();
    const t9 = await box.locator('h3').allTextContents();
    expect(t9).toContain('평소보다 적은 수입');
    expect(t9).not.toContain('아직 들어오지 않은 수입');
    const drop = await box.locator('.insight-income-drop .insight-text').allTextContents();
    expect(drop).toEqual(['용돈: 9월 수입 50,000원으로 평소 월 평균 100,000원보다 50% 적어요']);
    expect(await box.locator('.insight-income-drop .insight-label').first().innerText()).toBe('평소보다 적음');
    const all = await box.innerText();
    expect(all).not.toMatch(/과소비|더 썼|덜 썼|초과|⚠/);
    expect(all).not.toMatch(/NaN|undefined|Infinity/);
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    expect(await csp(page)).toEqual([]);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-S14 아무 항목도 없으면 새 빈 문구 (앞부분 유지)', async ({ browser }, testInfo) => {
    const a = await openApp(browser, testInfo);
    const hint = a.page.locator('#insights .hint');
    await expect(hint).toHaveText('아직 알려드릴 내용이 없어요. 기록이 쌓이면 반복 거래와 평소와 다른 지출·수입을 알려드려요.');
    expect(await hint.innerText()).toMatch(/^아직 알려드릴 내용이 없어요/);
    await a.ctx.close();
  });
});

// ====================================================================== C-S17 OS 모드 변경
test.describe('C-S17 OS 모드 변경', () => {
  test('저장값 없음: OS 를 바꾸면 새로고침 없이 색과 버튼 글자가 함께 바뀐다 / 저장값이 있으면 그대로', async ({ browser }, testInfo) => {
    const a = await openApp(browser, testInfo, { scheme: 'light' });
    const { page } = a;
    let navs = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs += 1; });
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const txt = () => page.locator('#theme-toggle .theme-toggle__text').innerText();
    await expect(page.locator('#theme-toggle')).toHaveAttribute('data-mode', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(txt).toBe('다크');
    await expect(page.locator('#theme-toggle')).toHaveAttribute('data-mode', 'dark');
    await expect(page.locator('#theme-toggle .icon')).toHaveClass(/icon--theme-dark/);
    expect(await bg()).toBe(DARK_BG);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(txt).toBe('라이트');
    expect(await bg()).toBe(LIGHT_BG);
    expect(navs).toBe(0);
    // 한 번 눌러 저장하면 이후 OS 변경을 따르지 않는다
    await page.locator('#theme-toggle').click(); // 라이트 -> 다크 저장
    await expect(page.locator('#theme-toggle .theme-toggle__text')).toHaveText('다크');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    expect(await txt()).toBe('다크');
    expect(await bg()).toBe(DARK_BG);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
    // 처음부터 저장값 light + OS 다크
    const b = await openApp(browser, testInfo, { scheme: 'dark', stored: 'light' });
    await expect(b.page.locator('#theme-toggle .theme-toggle__text')).toHaveText('라이트');
    await b.page.emulateMedia({ colorScheme: 'light' });
    await b.page.emulateMedia({ colorScheme: 'dark' });
    await b.page.waitForTimeout(300);
    expect(await b.page.locator('#theme-toggle .theme-toggle__text').innerText()).toBe('라이트');
    expect(await b.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG);
    await b.ctx.close();
  });
});

// ====================================================================== 정적 (C-S20, S22, S23)
test.describe('정적 검사', () => {
  test('C-S20 theme-auto.svg 와 icon--theme-auto 없음, 배포 아이콘 17개(원본 15 + theme 2)', async ({}, testInfo) => {
    onlyMobile(testInfo);
    expect(existsSync(join(PUBLIC, 'icons', 'theme-auto.svg'))).toBe(false);
    const css = readFileSync(join(PUBLIC, 'css', 'style.css'), 'utf8');
    expect(css).not.toMatch(/icon--theme-auto|theme-auto/);
    const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    expect(html).not.toMatch(/theme-auto|data-mode="auto"/);
    const js = ['theme.js', 'app.js', 'theme-init.js'].map((f) => readFileSync(join(PUBLIC, 'js', f.startsWith('theme-init') ? f : `${f === 'theme.js' ? 'lib/' : ''}${f}`), 'utf8')).join('\n');
    expect(js).not.toMatch(/theme-auto/);
  });

  test('C-S22 변경 범위: 금지 파일(schema.sql, tokens.css, components.css, theme-init.js, office, plan.md)은 git 변경 없음, 변경 파일은 허용 폴더 안', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    // tokens.css·components.css 는 재검증 4(사용자 요청: 다크 금색 선, 초기화 아이콘)에서 의도적으로 바뀜 - design.spec C-D1 이 허용 차이를 줄 단위로 검사한다
    const forbidden = ['src/backend/db/schema.sql', 'src/frontend/public/js/theme-init.js', 'src/frontend/office', 'docs/plan.md'];
    const existing = forbidden.filter((p) => existsSync(join(ROOT, p)));
    expect(git('status', '--porcelain', '--', ...existing).trim(), `금지 파일 변경: ${existing}`).toBe('');
    expect(git('diff', '--name-only', '5a0689d', '--', ...existing).trim(), `1단계 커밋 이후 금지 파일 변경: ${existing}`).toBe('');
    const changed = [...git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '')), ...git('diff', '--name-only', '5a0689d').split('\n').filter(Boolean)];
    const allowed = /^(src\/frontend\/public\/|src\/frontend\/test\/|src\/backend\/|e2e\/|docs\/|design_handoff_moneybook\/)/;
    const outside = changed.filter((f) => !allowed.test(f));
    expect(outside, `허용 폴더 밖 변경: ${outside}`).toEqual([]);
  });

  test('C-S23 API 변경은 insights 응답 키 2개 추가뿐: 라우트 목록 불변, 스키마 불변', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    const diff = git('diff', '5a0689d', '--', 'src/backend/rules/routes.js');
    const added = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    expect(added.filter((l) => l.startsWith('-')), '삭제된 줄 없음(추가 전용)').toEqual([]);
    expect(added.join('\n')).toMatch(/incomeDrops/);
    expect(added.join('\n')).toMatch(/missingIncome/);
    expect(git('diff', '5a0689d', '--stat', '--', 'src/backend/db/schema.sql').trim()).toBe('');
    const names = git('diff', '5a0689d', '--name-only', '--', 'src/backend', 'api').split('\n').filter(Boolean);
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'src/backend', 'api').split('\n').filter(Boolean);
    console.log(`BACKEND-CHANGED ${[...names, ...untracked].join(', ')}`);
    expect([...names, ...untracked].filter((f) => /api\/|routes|handlers?\.js|index\.js|auth|categor|transaction|stats|summary|db\//i.test(f) && !/rules\/routes\.js|test\//.test(f)), '인사이트 외 API/DB 파일 변경').toEqual([]);
  });
});
