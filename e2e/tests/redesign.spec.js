// docs/plan-redesign.md Q-R2: 화면 정리 완료 기준 C-R1~C-R26 (신규).
// 위치·크기는 getBoundingClientRect 로 +-1px. UI "오늘"은 2026-10-19 고정(newUiPage). 360/768 둘 다에서 실행(정적·스크린샷 항목은 360 에서만).
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, json, get } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';
import { SEED_EMAIL, SEED_PASSWORD } from '../helpers/env.js';
import { newApi } from '../helpers/api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const onlyMobile = (testInfo) => test.skip(widthOf(testInfo) !== 360, '정적·스크린샷 항목은 mobile-360 에서만');
const LINE = { light: 'rgb(230, 226, 217)', dark: 'rgb(75, 66, 49)' };

async function open(browser, testInfo, { scheme = 'light', hash = '#record', prepare, user, height, stored } = {}) {
  const u = user || await createLoggedInUser('rd');
  if (prepare) await prepare(u.api, u);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
  if (height) await page.setViewportSize({ width: widthOf(testInfo), height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript((v) => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective)); if (v) localStorage.setItem('mb-theme', v); }, stored ?? null);
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toBeVisible();
  return { ...u, ...ui, problems, requests };
}
const rect = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: +b.left.toFixed(2), r: +b.right.toFixed(2), t: +b.top.toFixed(2), b: +b.bottom.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; }, sel);
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const mkCat = async (api, type, name) => { const r = await json(api, 'POST', '/api/categories', { type, name }); expect(r.status(), await r.text()).toBe(201); };
const income = (api, category, amount, date, memo = '') => addTx(api, { type: 'income', category, amount, date, memo });
const expense = (api, category, amount, date, memo = '') => addTx(api, { type: 'expense', category, amount, date, memo });
const toggleOf = (page) => page.locator('#category-chips .chip--toggle');
const goHash = async (page, h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250); };

/** 화면 정렬선: .screen 최대 480 가운데 + 안쪽 20 */
const lineX = (page) => page.evaluate(() => { const vw = document.documentElement.clientWidth; const w = Math.min(vw, 480); return { left: (vw - w) / 2 + 20, right: (vw - w) / 2 + w - 20 }; });

// ====================================================================== 공통
test.describe('C-R1~C-R5 공통', () => {
  test('C-R1 정렬선: 헤더 이름·h1·요약 카드·폼 컨트롤·목록·인사이트 카드가 같은 x(왼쪽 +20), 폼 바깥에 카드 배경·테두리 없음 (기록·대시보드·내 정보, 라이트·다크)', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme, prepare: async (api) => { await expense(api, '식비', 5000, '2026-10-19', '점심'); await income(api, '급여', 100000, '2026-10-02'); } });
      const { page } = a;
      await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
      const { left, right } = await lineX(page);
      const full = { record: ['#month-totals', '#tx-form .segmented', '.amount-wrap', '.quick-amounts', '#category-chips', '#memo', '#save-btn', '#panel-record .card:has(#tx-list)'] };
      for (const sel of ['#user-name', '#panel-record h1', ...full.record]) {
        const r = await rect(page, sel);
        expect(near(r.l, left), `${scheme} record ${sel} 왼쪽 ${r.l} != ${left}`).toBe(true);
      }
      for (const sel of full.record) {
        const r = await rect(page, sel);
        expect(near(r.r, right), `${scheme} record ${sel} 오른쪽 ${r.r} != ${right}`).toBe(true);
      }
      // 폼 바깥은 카드가 아니다: 배경 투명, 테두리 0
      const formStyle = await page.locator('#tx-form').evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, bw: c.borderTopWidth, shadow: c.boxShadow }; });
      expect(formStyle).toEqual({ bg: 'rgba(0, 0, 0, 0)', bw: '0px', shadow: 'none' });
      await goHash(page, '#dashboard');
      await expect(page.locator('#kpi .sum-balance')).toBeVisible();
      for (const sel of ['#panel-dashboard h1', '#kpi', '.donut-card', '.insights-card']) {
        const r = await rect(page, sel);
        expect(near(r.l, left), `${scheme} dashboard ${sel} 왼쪽 ${r.l}`).toBe(true);
        if (sel !== '#panel-dashboard h1') expect(near(r.r, right), `${scheme} dashboard ${sel} 오른쪽 ${r.r}`).toBe(true);
      }
      expect(near((await rect(page, '.month-pill')).r, right), '월 알약 오른쪽').toBe(true);
      await goHash(page, '#account');
      for (const sel of ['#panel-account h1', '#panel-account .card', '#account-name', '#logout-btn']) {
        const r = await rect(page, sel);
        expect(near(r.l, left), `${scheme} account ${sel} 왼쪽 ${r.l}`).toBe(true);
      }
      expect(near((await rect(page, '#logout-btn')).r, right)).toBe(true);
      expect(near((await rect(page, '#panel-account .card')).r, right)).toBe(true);
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });

  test('C-R2 높이: 칩·세그먼트 항목·빠른 금액·아이콘 버튼·월 이동 44, 메모·이름 입력 48, 이름 저장 48, 기록 저장·로그아웃·로그인 52, 모든 누르는 요소 44 이상', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const a = await open(browser, testInfo, { prepare: async (api) => { await expense(api, '식비', 5000, '2026-10-19', '점심'); } });
    const { page } = a;
    const h = async (sel) => (await rect(page, sel)).h;
    const eq = (v, want, what) => expect(near(v, want), `${what} ${v} != ${want}`).toBe(true);
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    eq(await h('#category-chips button'), 44, '카테고리 칸');
    eq(await h('#type-expense'), 44, '세그먼트 항목');
    eq(await h('.quick-amounts button'), 44, '빠른 금액');
    await page.locator('#amount').fill('1');
    await expect(page.locator('#reset-btn')).toBeVisible();
    eq(await h('#reset-btn'), 44, '초기화 아이콘');
    eq(await h('#theme-toggle'), 44, '해·달 버튼');
    eq(await h('#month-prev'), 44, '월 이동(기록)');
    eq(await h('#memo'), 48, '메모');
    eq(await h('#save-btn'), 52, '저장');
    await goHash(page, '#dashboard');
    await expect(page.locator('#kpi .sum-balance')).toBeVisible();
    eq(await h('#dash-prev'), 44, '월 이동(대시보드)');
    eq((await rect(page, '#dash-prev')).w, 44, '월 이동 폭');
    eq(await h('.month-pill'), 44, '월 알약');
    eq(await h('#catview-expense'), 44, '보기 전환');
    await goHash(page, '#account');
    eq(await h('#account-name'), 48, '이름 입력');
    eq(await h('#account-save'), 48, '이름 저장');
    eq(await h('#logout-btn'), 52, '로그아웃');
    eq(await h('#account-back'), 44, '뒤로');
    await goHash(page, '#categories');
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    eq(await h('#catm-name'), 48, '카테고리 이름 입력');
    // 로그인 화면
    const lg = await newUiPage(browser, testInfo, {});
    await lg.page.goto('/login.html');
    eq((await rect(lg.page, '#email')).h, 48, '로그인 이메일');
    eq((await rect(lg.page, '#password')).h, 48, '로그인 비밀번호');
    eq((await rect(lg.page, '#submit-btn')).h, 52, '로그인 버튼');
    await lg.ctx.close();
    // 모든 누르는 요소 44 이상 (화면별 보이는 것만)
    for (const hash of ['#record', '#dashboard', '#account', '#categories']) {
      await goHash(page, hash);
      const small = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('button, a[href], summary, [role=button]').forEach((e) => {
          if (e.closest('[hidden]') || e.closest('.visually-hidden') || e.classList.contains('skip-link')) return;
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          if (r.width < 43.5 || r.height < 43.5) out.push(`${e.tagName}#${e.id}.${e.className} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
        });
        return out;
      });
      expect(small, `${hash} 44 미만 요소`).toEqual([]);
    }
    await a.ctx.close();
  });

  test('C-R3 모서리·테두리: 카드 20, 입력·버튼 14, 카테고리 칸 12, 세그먼트 트랙 14/항목 10, 카드 1px --color-line(다크 #4B4231)', async ({ browser }, testInfo) => {
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme });
      const { page } = a;
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      const st = (sel) => page.locator(sel).first().evaluate((e) => { const c = getComputedStyle(e); return { r: c.borderTopLeftRadius, bw: c.borderTopWidth, bc: c.borderTopColor, shadow: c.boxShadow }; });
      expect((await st('#month-totals')).r).toBe('20px');
      expect(await st('#month-totals')).toMatchObject({ bw: '1px', bc: LINE[scheme], shadow: 'none' });
      expect((await st('#memo')).r).toBe('14px');
      expect((await st('#save-btn')).r).toBe('14px');
      expect((await st('#category-chips button')).r).toBe('12px');
      expect((await st('#tx-form .segmented')).r).toBe('14px');
      expect((await st('#type-expense')).r).toBe('10px');
      await goHash(page, '#dashboard');
      await expect(page.locator('#kpi .sum-balance')).toBeVisible();
      for (const sel of ['#kpi', '.donut-card', '.insights-card']) expect(await st(sel), sel).toMatchObject({ r: '20px', bw: '1px', bc: LINE[scheme], shadow: 'none' });
      await goHash(page, '#account');
      expect((await st('#account-name')).r).toBe('14px');
      expect((await st('#logout-btn')).r).toBe('14px');
      expect((await st('#panel-account .card')).r).toBe('20px');
      await a.ctx.close();
    }
  });

  test('C-R4 숫자 tabular, 글꼴 Pretendard(숫자 Newsreader), Noto 요청 0, 외부 요청 0', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { prepare: async (api) => { await expense(api, '식비', 5000, '2026-10-19', '점심'); await income(api, '급여', 100000, '2026-10-02'); } });
    const { page } = a;
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    const fam = (sel) => page.locator(sel).first().evaluate((e) => { const c = getComputedStyle(e); return { tab: c.fontVariantNumeric, fam: c.fontFamily.split(',')[0].replace(/["']/g, '').trim() }; });
    for (const sel of ['#month-totals .sum-amount', '#month-totals .sum-balance__value', '#month-title-h', '.tx-amount']) expect((await fam(sel)).tab, sel).toContain('tabular-nums');
    expect((await fam('#month-totals .sum-balance__value')).fam).toBe('Newsreader');
    expect((await fam('body')).fam).toBe('Pretendard');
    await goHash(page, '#dashboard');
    await expect(page.locator('#kpi .sum-balance')).toBeVisible();
    await page.locator('#catview-expense').click();
    for (const sel of ['#kpi .sum-amount', '#kpi .sum-balance__value', '#dash-month', '#kpi .balance-rate']) expect((await fam(sel)).tab, sel).toContain('tabular-nums');
    await page.waitForTimeout(500);
    const origin = new URL(page.url()).origin;
    expect(a.requests.filter((u) => /noto/i.test(u)), 'Noto 요청').toEqual([]);
    expect(a.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')), '외부 요청').toEqual([]);
    await a.ctx.close();
  });

  test('C-R5 tokens.css·components.css 변경 없음(git), style.css·JS 에 hex·rgb 없음', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    expect(git('status', '--porcelain', '--', 'src/frontend/public/css/tokens.css', 'src/frontend/public/css/components.css').trim()).toBe('');
    const css = readFileSync(join(PUBLIC, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const f of ['app.js', 'account.js', 'charts.js', 'dashboard.js', 'record.js', 'insights.js', 'summary-card.js', 'lib/category-grid.js', 'lib/summary-data.js']) {
      expect(readFileSync(join(PUBLIC, 'js', f), 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
});

// ====================================================================== 헤더 · 내 정보
test.describe('C-R6~C-R7 헤더·내 정보', () => {
  test('C-R6 헤더: 이름 + › 와 해·달 버튼만(#logout-btn 없음), 20자 이름·긴 이메일에서 한 줄·말줄임·› 항상 보임', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    for (const [label, patch] of [['20자 W', { name: 'WWWWWWWWWWWWWWWWWWWW' }], ['긴 이메일', { name: null, email: `${'verylongaddress'.repeat(8)}@example-domain-name.example.com` }], ['짧은 이름', { name: '홍길동' }]]) {
      const a = await open(browser, testInfo, { hash: '#record' });
      const { page } = a;
      await page.route('**/api/auth/me', async (route) => { if (route.request().method() !== 'GET') return route.continue(); const res = await route.fetch(); const body = await res.json(); await route.fulfill({ response: res, json: { user: { ...body.user, ...patch } } }); });
      await page.reload();
      await expect(page.locator('#user-name-text')).toHaveText(patch.name ?? patch.email);
      expect(await page.locator('.app-header #logout-btn').count(), '헤더에 로그아웃 없음').toBe(0);
      expect(await page.locator('.app-header button, .app-header a').count(), '헤더 요소: 이름 링크 + 해·달').toBe(2);
      const m = await page.evaluate(() => {
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
        const t = document.querySelector('#user-name-text');
        return { hd: document.querySelector('.app-header').getBoundingClientRect().height, link: r('#user-name'), text: r('#user-name-text'), chev: r('#user-name .icon'), tog: r('#theme-toggle'), vw: document.documentElement.clientWidth, ell: getComputedStyle(t).textOverflow, truncated: t.scrollWidth > t.clientWidth, chevHidden: document.querySelector('#user-name .icon').getAttribute('aria-hidden') };
      });
      expect(m.hd, `${label} 헤더 한 줄`).toBeLessThan(80);
      expect(m.ell).toBe('ellipsis');
      expect(m.chev.r, `${label} › 는 링크 안`).toBeLessThanOrEqual(m.link.r + 0.5);
      expect(m.chev.l, `${label} › 는 글자 오른쪽`).toBeGreaterThanOrEqual(m.text.r - 0.5);
      expect(m.link.r, `${label} 링크/토글 겹침`).toBeLessThanOrEqual(m.tog.l + 0.5);
      expect(m.tog.r).toBeLessThanOrEqual(m.vw + 0.5);
      expect(m.chevHidden).toBe('true');
      expect(m.link.w, `${label} 이름 칸 폭`).toBeGreaterThan(40);
      if (label === '긴 이메일') expect(m.truncated).toBe(true);
      await expectNoHorizontalScroll(page, w);
      // 접근 이름: 이름이 있으면 "내 정보: 이름", 없으면 "이름 설정"
      const aria = await page.locator('#user-name').getAttribute('aria-label');
      expect(aria).toMatch(patch.name === null ? /이름 설정/ : /내 정보/);
      await a.ctx.close();
    }
  });

  test('C-R7 내 정보: ‹ 뒤로 -> #record, 계정 카드 이메일 한 줄(말줄임·title·가입일 없음), 이름 입력+저장 같은 줄, 이름 저장 흐름, 로그아웃 외곽선 버튼 -> 로그인 화면, 높이 500 에서 겹침 없음', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const a = await open(browser, testInfo, { hash: '#account', height: 500 });
    const { page, account } = a;
    const back = page.getByRole('link', { name: '뒤로' });
    await expect(back).toBeVisible();
    expect(await back.innerText()).toContain('뒤로');
    expect((await rect(page, '#account-back')).h).toBeGreaterThanOrEqual(43.5);
    // 계정 카드
    const card = await page.locator('#panel-account .card').evaluate((c) => ({ text: c.innerText, rowH: c.querySelector('.account-row').getBoundingClientRect().height, val: c.querySelector('#account-email').textContent, title: c.querySelector('#account-email').getAttribute('title'), ell: getComputedStyle(c.querySelector('#account-email')).textOverflow, nowrap: getComputedStyle(c.querySelector('#account-email')).whiteSpace }));
    expect(card.text).toContain('이메일');
    expect(card.text).not.toMatch(/가입/);
    expect(card.val).toBe(account.email);
    expect(card.title).toBe(account.email);
    expect(card.ell).toBe('ellipsis');
    expect(card.nowrap).toBe('nowrap');
    expect(near(card.rowH, 52)).toBe(true);
    // 이름 줄
    const nameRow = await page.evaluate(() => { const i = document.querySelector('#account-name').getBoundingClientRect(); const s = document.querySelector('#account-save').getBoundingClientRect(); return { sameRow: Math.abs(i.top - s.top) < 1.5 && Math.abs(i.height - s.height) < 1.5, gap: s.left - i.right, sRight: s.right }; });
    expect(nameRow.sameRow, JSON.stringify(nameRow)).toBe(true);
    await expect(page.locator('#account-hint')).toContainText('20자 이하');
    // 이름 저장 흐름
    await page.locator('#account-name').fill('새이름');
    await page.locator('#account-save').click();
    await expect(page.locator('#user-name-text')).toHaveText('새이름');
    await expect(page.locator('#account-status')).not.toHaveText('');
    // 로그아웃: 외곽선 버튼, 일반 흐름의 끝, 다른 요소와 겹치지 않음
    const lo = page.locator('#logout-btn');
    await lo.scrollIntoViewIfNeeded();
    const geo = await page.evaluate(() => {
      const L = document.querySelector('#logout-btn'); const lr = L.getBoundingClientRect(); const c = getComputedStyle(L);
      const others = ['#account-save', '#account-hint', '#account-name-error', '#account-status', '#panel-account .card'].map((s) => ({ s, r: document.querySelector(s).getBoundingClientRect() }));
      const overlap = others.filter((o) => o.r.height > 0 && o.r.bottom > lr.top && o.r.top < lr.bottom && o.r.right > lr.left && o.r.left < lr.right).map((o) => o.s);
      return { pos: c.position, bg: c.backgroundColor, bw: c.borderTopWidth, icon: !!L.querySelector('.icon'), text: L.textContent.trim(), w: lr.width, gapFromSave: lr.top - (document.querySelector('#account-save').getBoundingClientRect().bottom + scrollY - scrollY), overlap, vh: innerHeight };
    });
    expect(geo.pos).not.toBe('fixed');
    expect(geo.pos).not.toBe('sticky');
    expect(geo.bg).toBe('rgba(0, 0, 0, 0)');
    expect(geo.bw).toBe('1px');
    expect(geo.icon).toBe(true);
    expect(geo.text).toBe('로그아웃');
    expect(geo.overlap, `높이 500 겹침 ${JSON.stringify(geo)}`).toEqual([]);
    expect(geo.gapFromSave).toBeGreaterThanOrEqual(31.5);
    await page.screenshot({ path: join(testInfo.outputDir, `account-h500-${widthOf(testInfo)}.png`) });
    // 뒤로 -> 기록
    await back.click();
    await expect(page.locator('#panel-record')).toBeVisible();
    await expect(page).toHaveURL(/#record$/);
    await goHash(page, '#account');
    await lo.click();
    await page.waitForURL(/login\.html/);
    expect(a.problems.filter((p) => !/401/.test(p))).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 기록
test.describe('C-R8~C-R14 기록', () => {
  test('C-R8 제목 줄: h1 왼쪽, 오늘 날짜 오른쪽 같은 줄(연도 없는 형식)', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo);
    const { page } = a;
    const h1 = await rect(page, '#panel-record h1');
    const cap = await rect(page, '#today-caption');
    const { right } = await lineX(page);
    expect(cap.l).toBeGreaterThan(h1.r);
    expect(near(cap.r, right), '날짜는 오른쪽 끝').toBe(true);
    expect(Math.abs((h1.t + h1.b) / 2 - (cap.t + cap.b) / 2), '같은 줄').toBeLessThan(14);
    expect((await page.locator('#today-caption').innerText()).trim()).toBe('10월 19일 월요일');
    await a.ctx.close();
  });

  test('C-R9 요약 카드 1장: 남은 돈 -> 구분선 -> 수입|지출, 경계 금액(0, 877,530, 100,000,000, 999,999,999, 음수)에서 금액 글자가 한 줄·잘림·가로 스크롤 없음, 달 이동 시 라벨', async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const w = widthOf(testInfo);
    const cases = [
      ['0원', async () => {}, '0원'],
      ['877,530', async (api) => { await income(api, '급여', 1_000_000, '2026-10-02'); await expense(api, '식비', 122_470, '2026-10-03'); }, '877,530원'],
      ['1억 지출(음수)', async (api) => { await expense(api, '식비', 100_000_000, '2026-10-03'); }, '−100,000,000원'],
      ['999,999,999 수입·지출', async (api) => {
        for (let i = 0; i < 10; i++) { await income(api, '급여', 99_999_999, '2026-10-02'); await expense(api, '식비', 99_999_999, '2026-10-03'); }
        await income(api, '급여', 9, '2026-10-04'); await expense(api, '식비', 9, '2026-10-05');
      }, '0원'],
    ];
    for (const [label, prep, balanceText] of cases) {
      const a = await open(browser, testInfo, { prepare: prep });
      const { page } = a;
      for (const [where, hash, sel] of [['기록', '#record', '#month-totals'], ['대시보드', '#dashboard', '#kpi']]) {
        await goHash(page, hash);
        await expect(page.locator(`${sel} .sum-balance`)).toBeVisible();
        const m = await page.locator(sel).evaluate((card) => {
          const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].map((r) => Math.round(r.top))).size; };
          const cr = card.getBoundingClientRect();
          const amounts = [...card.querySelectorAll('.sum-balance__value, .sum-amount')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, lines: lines(e), nowrap: getComputedStyle(e).whiteSpace, clipped: e.scrollWidth > e.clientWidth + 1, inside: r.right <= cr.right - 1 && r.left >= cr.left + 1, overflow: getComputedStyle(e).textOverflow }; });
          return { parts: { bal: !!card.querySelector('.sum-balance'), divider: !!card.querySelector('.sum-divider'), cols: card.querySelectorAll('.sum-col').length }, amounts, label: card.querySelector('.sum-balance__label').textContent.trim(), order: [...card.children].map((c) => c.className.split(' ')[0]) };
        });
        expect(m.parts, `${label}/${where}`).toEqual({ bal: true, divider: true, cols: 2 });
        const iBal = m.order.indexOf('sum-balance'); const iDiv = m.order.indexOf('sum-divider'); const iPair = m.order.indexOf('sum-pair');
        expect(iBal < iDiv && iDiv < iPair, `${label}/${where} 순서 ${m.order}`).toBe(true);
        for (const x of m.amounts) {
          expect(x.lines, `${label}/${where} "${x.text}" 줄 수`).toBe(1);
          expect(x.nowrap).toBe('nowrap');
          expect(x.clipped, `${label}/${where} "${x.text}" 잘림`).toBe(false);
          expect(x.inside, `${label}/${where} "${x.text}" 카드 밖`).toBe(true);
          expect(x.overflow).not.toBe('ellipsis');
        }
        expect(m.amounts[0].text, `${label}/${where}`).toBe(balanceText);
        expect(m.label).toBe('이번 달 남은 돈');
        await expectNoHorizontalScroll(page, w);
      }
      if (label === '999,999,999 수입·지출') {
        await goHash(page, '#record');
        const amts = await page.locator('#month-totals .sum-amount').allTextContents();
        expect(amts).toEqual(['999,999,999원', '999,999,999원']);
        // 두 줄로 내려가는 칸은 금액이 오른쪽 정렬
        const al = await page.locator('#month-totals .sum-amount').first().evaluate((e) => ({ ml: getComputedStyle(e).marginLeft, ta: getComputedStyle(e).textAlign }));
        console.log(`WRAP-ALIGN ${JSON.stringify(al)}`);
        await page.screenshot({ path: join(testInfo.outputDir, `sum-999-${w}.png`), clip: { x: 0, y: 0, width: w, height: 300 } });
      }
      if (label === '877,530') {
        await goHash(page, '#record');
        await page.locator('#month-prev').click();
        await expect(page.locator('#month-totals .sum-balance__label')).toHaveText('9월 남은 돈');
      }
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });

  test('C-R10 간격: 요약 카드 아래 ↔ 종류 버튼 위 12, 종류 버튼 아래 ↔ 금액 라벨 줄 위 10', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo);
    const { page } = a;
    const card = await rect(page, '#month-totals');
    const seg = await rect(page, '#tx-form .segmented');
    const head = await rect(page, '.field-head');
    expect(near(seg.t - card.b, 12), `카드-종류 ${seg.t - card.b}`).toBe(true);
    expect(near(head.t - seg.b, 10), `종류-금액 라벨 줄 ${head.t - seg.b}`).toBe(true);
    await a.ctx.close();
  });

  test('C-R11 빠른 금액 3칸 너비 같음 한 줄, 접근 이름 그대로', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo);
    const { page } = a;
    const bs = await page.locator('.quick-amounts button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, t: r.top, name: e.getAttribute('aria-label'), text: e.textContent }; }));
    expect(bs).toHaveLength(3);
    expect(near(bs[0].w, bs[1].w) && near(bs[1].w, bs[2].w), JSON.stringify(bs)).toBe(true);
    expect(new Set(bs.map((b) => Math.round(b.t))).size).toBe(1);
    expect(bs.map((b) => b.name)).toEqual(['1천원 더하기', '1만원 더하기', '5만원 더하기']);
    expect(bs.map((b) => b.text)).toEqual(['+1천', '+1만', '+5만']);
    await a.ctx.close();
  });

  test('C-R12 메모: 보이는 라벨 없음, placeholder, getByLabel 로 찾음, 제안 칩·오류 동작', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { prepare: async (api) => { for (const d of ['2026-10-01', '2026-10-05', '2026-10-09']) await expense(api, '식비', 4500, d, '스타벅스'); } });
    const { page } = a;
    const memo = page.getByLabel('메모 (선택)');
    await expect(memo).toHaveCount(1);
    expect(await memo.getAttribute('id')).toBe('memo');
    expect(await memo.getAttribute('placeholder')).toBe('메모 (선택)');
    const lab = await rect(page, 'label[for="memo"]');
    expect(lab.w <= 2 && lab.h <= 2, `라벨은 시각적으로만 숨김 ${JSON.stringify(lab)}`).toBe(true);
    // 입력 칸 위에 보이는 "메모" 글자가 없다
    const vis = await page.evaluate(() => [...document.querySelectorAll('#tx-form .field')].filter((f) => f.querySelector('#memo')).map((f) => [...f.children].filter((c) => c.tagName === 'LABEL' && c.getBoundingClientRect().width > 2).length)[0]);
    expect(vis).toBe(0);
    await memo.pressSequentially('스타');
    await expect(page.locator('#memo-suggestions button').first()).toBeVisible();
    await page.locator('#memo-suggestions button').first().click();
    await expect(memo).toHaveValue('스타벅스');
    // 오류: 금액 없이 저장 -> 필드 오류
    await page.locator('#amount').fill('');
    await page.locator('#save-btn').click({ force: true });
    await expect(page.locator('#amount-error')).not.toHaveText('');
    await a.ctx.close();
  });

  test('C-R13 저장 버튼: sticky 유지, 탭바 위, 후광이 배경색(--color-bg), 되돌리기·초기화·날짜 변경·수정 취소 동작', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme, height: widthOf(testInfo) === 360 ? 800 : 1024, prepare: async (api) => { await expense(api, '식비', 3000, '2026-10-19', '기존'); } });
      const { page } = a;
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      const m = await page.evaluate(() => {
        const s = document.querySelector('#save-btn'); const c = getComputedStyle(s);
        const probe = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).color; i.remove(); return x; };
        const r = s.getBoundingClientRect(); const t = document.querySelector('.tabbar').getBoundingClientRect();
        return { pos: c.position, shadow: c.boxShadow, bg: probe('--color-bg'), surface: probe('--color-surface'), bottom: r.bottom, tabTop: t.top };
      });
      expect(m.pos).toBe('sticky');
      expect(m.shadow, `${scheme} 후광은 배경색`).toContain(m.bg);
      if (scheme === 'light') expect(m.shadow, '라이트에서 카드색(흰색) 후광 아님').not.toContain(m.surface);
      expect(m.bottom).toBeLessThanOrEqual(m.tabTop + 0.5);
      // 저장 -> 되돌리기 버튼, 초기화는 저장 직후 숨김
      await page.locator('#category-chips button', { hasText: '교통' }).click();
      await page.locator('#amount').fill('7000');
      await expect(page.locator('#reset-btn')).toBeVisible();
      await page.locator('#save-btn').click();
      await expect(page.locator('#flash')).toHaveText('저장했어요');
      await expect(page.locator('#flash-undo')).toBeVisible();
      await expect(page.locator('#reset-btn')).toBeHidden();
      // 수정 취소
      await page.locator('#tx-list .tx-edit', { hasText: '기존' }).click();
      await expect(page.locator('#cancel-edit-btn')).toBeVisible();
      await page.locator('#cancel-edit-btn').click();
      await expect(page.locator('#cancel-edit-btn')).toBeHidden();
      // 날짜 변경
      await page.locator('#date-details summary').click();
      await expect(page.locator('#date')).toBeVisible();
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });

  test('C-R14 기록 화면에 인사이트가 없다', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo);
    expect(await a.page.locator('#panel-record #insights, #panel-record .insights-card, #panel-record .insight-section').count()).toBe(0);
    await expect(a.page.locator('#panel-dashboard #insights')).toHaveCount(1);
    await a.ctx.close();
  });
});

// ====================================================================== 카테고리 격자
test.describe('C-R15~C-R18 카테고리 격자', () => {
  test('C-R15 8개: 4열 x 2줄, 칸 너비 같음, 가로 스크롤 없음, 선택 칩 체크, 다시 Enter 로 저장 / 0개: 빈 상태', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo);
    const { page } = a;
    await expect(page.locator('#category-chips button')).toHaveCount(8);
    const g = await page.evaluate(() => { const ul = document.getElementById('category-chips'); const bs = [...ul.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return { cols: new Set(bs.map((r) => Math.round(r.left))).size, rows: new Set(bs.map((r) => Math.round(r.top))).size, widths: bs.map((r) => +r.width.toFixed(2)), scroll: ul.scrollWidth > ul.clientWidth + 1, gridCols: getComputedStyle(ul).gridTemplateColumns.split(' ').length }; });
    expect(g.cols).toBe(4);
    expect(g.rows).toBe(2);
    expect(g.gridCols).toBe(4);
    expect(Math.max(...g.widths) - Math.min(...g.widths)).toBeLessThanOrEqual(1);
    expect(g.scroll).toBe(false);
    expect(await toggleOf(page).count(), '8개면 토글 없음').toBe(0);
    await expectNoHorizontalScroll(page, w);
    const chip = page.locator('#category-chips button', { hasText: '교통' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(await chip.locator('.icon--check').count(), '선택은 체크 아이콘').toBe(1);
    await page.locator('#amount').fill('1500');
    await chip.focus();
    await chip.press('Enter'); // 선택된 칩에서 다시 Enter -> 저장
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    // 0개: 모두 사용 안 함
    const z = await open(browser, testInfo, { prepare: async (api) => {
      // API 는 마지막 활성 카테고리를 끄지 못한다(409) -> 0개는 만들 수 없고 1개까지만
      const items = (await (await get(api, '/api/categories')).json()).items.filter((i) => i.type === 'expense');
      for (const it of items.slice(1)) expect((await json(api, 'PATCH', `/api/categories/${it.id}`, { active: false })).status()).toBe(200);
      expect((await json(api, 'PATCH', `/api/categories/${items[0].id}`, { active: false })).status(), '마지막 카테고리는 끌 수 없음').toBe(409);
    } });
    await expect(z.page.locator('#panel-record')).toBeVisible();
    await z.page.waitForTimeout(600);
    const empty = await z.page.evaluate(() => ({ chips: document.querySelectorAll('#category-chips button').length, text: document.getElementById('category-chips').innerText.trim(), scroll: document.documentElement.scrollWidth }));
    console.log(`GRID-1 ${JSON.stringify(empty)}`);
    expect(empty.chips).toBe(1);
    expect(empty.scroll).toBeLessThanOrEqual(w);
    expect(z.problems).toEqual([]);
    await z.ctx.close();
    await a.ctx.close();
  });

  test('C-R16 9개: 7개 + 더 보기 (2) -> 9개 + 접기 -> 다시 접힘, 30개 펼침은 8줄·겹침 없음, 유형별로 기억', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo, { prepare: async (api) => { await mkCat(api, 'expense', '아홉째'); } });
    const { page } = a;
    await expect(page.locator('#category-chips button')).toHaveCount(8);
    await expect(toggleOf(page)).toHaveText('더 보기 (2)');
    await expect(toggleOf(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await toggleOf(page).getAttribute('aria-controls')).toBe('category-chips');
    expect(await page.locator('#category-chips button:not(.chip--toggle)').count()).toBe(7);
    await toggleOf(page).click();
    await expect(page.locator('#category-chips button')).toHaveCount(10);
    await expect(toggleOf(page)).toHaveText('접기');
    await expect(toggleOf(page)).toHaveAttribute('aria-expanded', 'true');
    // 포커스: 펼친 뒤 8번째 카테고리
    expect(await page.evaluate(() => document.activeElement.textContent)).toBe('기타');
    await toggleOf(page).click();
    await expect(page.locator('#category-chips button')).toHaveCount(8);
    await expect(toggleOf(page)).toHaveAttribute('aria-expanded', 'false');
    // 수입 탭은 8 미만(4개): 토글 없음, 지출로 돌아오면 접힘 상태 유지
    await page.locator('#type-income').click();
    await expect(page.locator('#category-chips button')).toHaveCount(4);
    await page.locator('#type-expense').click();
    await expect(toggleOf(page)).toHaveText('더 보기 (2)');
    // 30개
    const b = await open(browser, testInfo, { prepare: async (api) => { for (let i = 0; i < 22; i++) await mkCat(api, 'expense', `카테고리${String(i + 1).padStart(2, '0')}`); } });
    await expect(toggleOf(b.page)).toHaveText('더 보기 (23)');
    await toggleOf(b.page).click();
    await expect(b.page.locator('#category-chips button')).toHaveCount(31);
    const geo = await b.page.evaluate(() => {
      const bs = [...document.querySelectorAll('#category-chips button')].map((e) => e.getBoundingClientRect());
      let overlap = 0;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const p = bs[i]; const q = bs[j]; if (p.left < q.right - 0.5 && p.right > q.left + 0.5 && p.top < q.bottom - 0.5 && p.bottom > q.top + 0.5) overlap += 1; }
      return { rows: new Set(bs.map((r) => Math.round(r.top))).size, overlap, h: document.getElementById('category-chips').getBoundingClientRect().height };
    });
    expect(geo.rows, JSON.stringify(geo)).toBe(8);
    expect(geo.overlap).toBe(0);
    await expectNoHorizontalScroll(b.page, w);
    await b.page.screenshot({ path: join(testInfo.outputDir, `grid-30-${w}.png`), fullPage: false });
    expect(a.problems.concat(b.problems)).toEqual([]);
    await a.ctx.close();
    await b.ctx.close();
  });

  test('C-R17 접힌 부분의 카테고리가 빠른 입력·자동완성·거래 수정으로 선택되면 자동으로 펼쳐져 선택이 보인다, 사용 안 함 거래 수정은 "사용 안 함" 칩', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const prep = async (api) => {
      await mkCat(api, 'expense', '아홉째');
      for (const d of ['2026-10-02', '2026-10-09', '2026-10-16']) await expense(api, '아홉째', 5500, d, '아홉메모');
    };
    const pressedVisible = async (page, name) => {
      const c = page.locator('#category-chips button', { hasText: name }).first();
      await expect(c).toHaveAttribute('aria-pressed', 'true');
      const r = await c.boundingBox();
      expect(r.width).toBeGreaterThan(0);
      const inView = await c.evaluate((e) => { const b = e.getBoundingClientRect(); return b.right <= document.documentElement.clientWidth && b.left >= 0; });
      expect(inView).toBe(true);
    };
    // (a) 빠른 입력
    const a = await open(browser, testInfo, { prepare: prep });
    await expect(toggleOf(a.page)).toHaveText('더 보기 (2)');
    await expect(a.page.locator('#quick-chips button').first()).toBeVisible();
    await a.page.locator('#quick-chips button', { hasText: '아홉메모' }).first().click();
    await pressedVisible(a.page, '아홉째');
    expect(await a.page.locator('#category-chips button', { hasText: '아홉째' }).count()).toBe(1);
    // (b) 자동완성
    const b = await open(browser, testInfo, { user: a });
    await expect(toggleOf(b.page)).toHaveText('더 보기 (2)');
    await b.page.locator('#memo').pressSequentially('아홉');
    await expect(b.page.locator('#memo-suggestions button').first()).toBeVisible();
    await b.page.locator('#memo-suggestions button').first().click();
    await pressedVisible(b.page, '아홉째');
    // (c) 거래 수정
    const c = await open(browser, testInfo, { user: a });
    await expect(toggleOf(c.page)).toHaveText('더 보기 (2)');
    await c.page.locator('#tx-list .tx-edit', { hasText: '아홉메모' }).first().click();
    await pressedVisible(c.page, '아홉째');
    await c.page.screenshot({ path: join(testInfo.outputDir, `auto-expand-${widthOf(testInfo)}.png`) });
    // 다른 칩을 고르면 선택이 접힌 곳에서 벗어나 다시 접을 수 있다
    await c.page.locator('#category-chips button', { hasText: '식비' }).click();
    await expect(toggleOf(c.page)).toBeVisible();
    // (d) 사용 안 함 카테고리 거래 수정
    const d = await open(browser, testInfo, { user: a, prepare: async (api) => {
      const items = (await (await get(api, '/api/categories')).json()).items;
      const it = items.find((x) => x.type === 'expense' && x.name === '아홉째');
      expect((await json(api, 'PATCH', `/api/categories/${it.id}`, { active: false })).status()).toBe(200);
    } });
    await d.page.locator('#tx-list .tx-edit', { hasText: '아홉메모' }).first().click();
    const legacy = d.page.locator('#category-chips button', { hasText: '아홉째 (사용 안 함)' });
    await expect(legacy).toHaveCount(1);
    await expect(legacy).toHaveAttribute('aria-pressed', 'true');
    expect(await legacy.boundingBox()).not.toBeNull();
    for (const x of [a, b, c, d]) expect(x.problems).toEqual([]);
    for (const x of [a, b, c, d]) await x.ctx.close();
  });

  test('C-R18 긴 이름: 최대 2줄, 넘치면 말줄임 + title(전체 이름), 접근 이름은 전체 이름, 짧은 이름에는 title 없음', async ({ browser }, testInfo) => {
    const longW = 'W'.repeat(15);
    const longKo = '가나다라마바사아자차카타파하가';
    const a = await open(browser, testInfo, { prepare: async (api) => { await mkCat(api, 'expense', longW); await mkCat(api, 'expense', longKo); } });
    const { page } = a;
    await toggleOf(page).click();
    const info = await page.locator('#category-chips .chip--cat:not(.chip--toggle)').evaluateAll((els) => els.map((b) => {
      const n = b.querySelector('.chip__name'); const cs = getComputedStyle(n);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      return { name: n.textContent, title: b.getAttribute('title'), clamp: cs.webkitLineClamp || cs.lineClamp, lines: Math.round(n.getBoundingClientRect().height / lh), clipped: n.scrollHeight > n.clientHeight + 1, h: b.getBoundingClientRect().height, aria: b.getAttribute('aria-label') };
    }));
    for (const i of info) {
      expect(i.clamp, i.name).toBe('2');
      expect(i.lines, `${i.name} 줄 수`).toBeLessThanOrEqual(2);
      expect(i.h).toBeGreaterThanOrEqual(43.5);
      if (i.clipped) expect(i.title, `${i.name} 잘림 -> title`).toBe(i.name); else expect(i.title, `${i.name} 안 잘림 -> title 없음`).toBeNull();
    }
    const w15 = info.find((i) => i.name === longW);
    expect(w15.clipped, `W 15자는 잘린다 ${JSON.stringify(w15)}`).toBe(true);
    expect(w15.title).toBe(longW);
    console.log(`LONG-NAMES ${JSON.stringify(info.filter((i) => i.name.length >= 15).map((i) => ({ n: i.name, clipped: i.clipped, title: !!i.title, lines: i.lines })))}`);
    expect(info.find((i) => i.name === '식비').title).toBeNull();
    for (const n of [longW, longKo]) await expect(page.getByRole('button', { name: n })).toHaveCount(1); // 접근 이름 = 전체 이름
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    await page.screenshot({ path: join(testInfo.outputDir, `long-names-${widthOf(testInfo)}.png`) });
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 대시보드
test.describe('C-R19~C-R23 대시보드', () => {
  test('C-R19 제목 줄: h1 "대시보드" 보임, 오른쪽 월 알약(44, 이전·다음 44x44), #dash-month 글자, 미래 달까지 이동, 겹침 없음', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard' });
    const { page } = a;
    await expect(page.locator('#dash-month')).toHaveText('2026년 10월');
    await expect(page.locator('#panel-dashboard h1')).toHaveText('대시보드');
    await expect(page.locator('#panel-dashboard h1')).toBeVisible();
    const h1 = await rect(page, '#panel-dashboard h1');
    const pill = await rect(page, '.month-pill');
    const prev = await rect(page, '#dash-prev');
    const next = await rect(page, '#dash-next');
    const { right } = await lineX(page);
    expect(near(pill.h, 44)).toBe(true);
    expect(near(prev.w, 44) && near(prev.h, 44) && near(next.w, 44) && near(next.h, 44), JSON.stringify({ prev, next })).toBe(true);
    expect(near(pill.r, right)).toBe(true);
    const sameRow = Math.abs((h1.t + h1.b) / 2 - (pill.t + pill.b) / 2) < 6;
    expect(h1.r <= pill.l + 0.5 || !sameRow, '겹침 없음').toBe(true);
    if (widthOf(testInfo) === 360) expect(sameRow, '360 에서도 한 줄(들어가는 경우)').toBe(true);
    await page.locator('#dash-next').click();
    await expect(page.locator('#dash-month')).toHaveText('2026년 11월');
    await page.locator('#dash-next').click();
    await expect(page.locator('#dash-month')).toHaveText('2026년 12월');
    await page.locator('#dash-next').click();
    await expect(page.locator('#dash-month')).toHaveText('2027년 1월');
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    await a.ctx.close();
  });

  test('C-R20 #kpi: 기록 요약 카드와 같은 모양, 비율 줄 유지, 막대 없음, 전월 대비 문구가 각 열 아래', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => {
      await income(api, '급여', 2_000_000, '2026-10-05'); await expense(api, '식비', 1_350_000, '2026-10-06');
      await income(api, '급여', 1_000_000, '2026-09-05'); await expense(api, '식비', 900_000, '2026-09-06');
    } });
    const { page } = a;
    await expect(page.locator('#kpi .sum-balance')).toBeVisible();
    const shape = (sel) => page.locator(sel).evaluate((c) => ({ kids: [...c.children].map((x) => x.className.split(' ')[0]).filter((x) => x !== 'balance-rate'), bf: getComputedStyle(c.querySelector('.sum-balance__value')).fontSize, r: getComputedStyle(c).borderTopLeftRadius, w: c.getBoundingClientRect().width, pad: getComputedStyle(c).paddingLeft }));
    const dash = await shape('#kpi');
    await goHash(page, '#record');
    await expect(page.locator('#month-totals .sum-balance')).toBeVisible();
    const rec = await shape('#month-totals');
    expect(dash).toEqual(rec);
    await goHash(page, '#dashboard');
    await expect(page.locator('#kpi .balance-rate')).toHaveText('수입의 32.5%가 남았어요');
    const rate = await page.evaluate(() => { const r = document.querySelector('#kpi .balance-rate').getBoundingClientRect(); const c = document.querySelector('#kpi').getBoundingClientRect(); const v = document.querySelector('#kpi .sum-balance__value').getBoundingClientRect(); return { right: c.right - r.right, ta: getComputedStyle(document.querySelector('#kpi .balance-rate')).textAlign, below: r.top >= v.bottom - 1 }; });
    expect(rate.below).toBe(true);
    expect(rate.right, `비율 줄은 오른쪽 정렬 ${JSON.stringify(rate)}`).toBeLessThanOrEqual(22);
    expect(await page.locator('#kpi .bar-track, #kpi .bar-fill').count()).toBe(0);
    const cols = await page.locator('#kpi .sum-col').evaluateAll((els) => els.map((c) => { const l = c.querySelector('.sum-line').getBoundingClientRect(); const x = c.querySelector('.kpi-extra'); return { extra: x.textContent, below: x.getBoundingClientRect().top >= l.bottom - 1, inside: c.contains(x) }; }));
    expect(cols).toEqual([
      { extra: '▲ 지난달보다 수입이 100.0% 늘었어요', below: true, inside: true },
      { extra: '▲ 지난달보다 지출이 50.0% 늘었어요', below: true, inside: true },
    ]);
    await a.ctx.close();
  });

  test('C-R21 카테고리 카드: 행마다 열 위치 같음(금액·% 오른쪽 끝 일치), 막대 너비 = 금액 ÷ 최대, "그 외 N개" 행, 지출/수입 전환, 도넛, 표로 보기 위치, 카테고리 관리 링크', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const extra = ['아홉째', '열째', '열한째'];
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => {
      for (const n of extra) await mkCat(api, 'expense', n);
      const all = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', ...extra];
      for (const [i, c] of all.entries()) await expense(api, c, 90_000 - i * 7_000, '2026-10-05');
      await income(api, '급여', 2_000_000, '2026-10-02'); await income(api, '용돈', 100_000, '2026-10-03');
    } });
    const { page } = a;
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    await expect(page.locator('#donut-title')).toHaveText('카테고리별 지출');
    const rows = await page.locator('#chart-donut .legend li').evaluateAll((lis) => lis.map((li) => {
      const g = (s) => li.querySelector(s).getBoundingClientRect();
      const sw = li.querySelector('.swatch').getBoundingClientRect();
      const track = li.querySelector('.legend-bar').getBoundingClientRect(); const fill = li.querySelector('.legend-bar__fill').getBoundingClientRect();
      return { name: li.querySelector('.legend-label').textContent, amount: li.querySelector('.legend-amount').textContent, swL: sw.left, nameL: g('.legend-label').left, amtR: g('.legend-amount').right, ratR: g('.legend-ratio').right, ratio: fill.width / track.width, trackL: track.left, trackR: track.right, barHidden: li.querySelector('.legend-bar').getAttribute('aria-hidden'), fillH: fill.height };
    }));
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(near(r.swL, rows[0].swL), `${r.name} 견본 x`).toBe(true);
      expect(near(r.nameL, rows[0].nameL), `${r.name} 이름 x`).toBe(true);
      expect(near(r.amtR, rows[0].amtR), `${r.name} 금액 오른쪽 끝 ${r.amtR} vs ${rows[0].amtR}`).toBe(true);
      expect(near(r.ratR, rows[0].ratR), `${r.name} % 오른쪽 끝`).toBe(true);
      expect(near(r.trackL, rows[0].trackL) && near(r.trackR, rows[0].trackR), `${r.name} 막대 트랙`).toBe(true);
      expect(r.barHidden).toBe('true');
      expect(near(r.fillH, 6)).toBe(true);
    }
    expect(near(rows[0].trackL, rows[0].nameL, 14), '막대 왼쪽 들여쓰기는 견본 열만큼').toBe(true);
    const nums = rows.map((r) => Number(r.amount.replace(/[^0-9]/g, '')));
    const mx = Math.max(...nums);
    rows.forEach((r, i) => expect(Math.abs(r.ratio - nums[i] / mx), `${r.name} 막대 ${r.ratio.toFixed(3)} vs ${(nums[i] / mx).toFixed(3)}`).toBeLessThan(0.02));
    expect(Math.max(...rows.map((r) => r.ratio))).toBeGreaterThan(0.98);
    // "그 외 N개" 행: 묶인 이름 줄과 접근 설명
    const last = page.locator('#chart-donut .legend li').last();
    await expect(last.locator('.legend-label')).toHaveText('그 외 4개');
    await expect(last.locator('.legend-members')).toContainText('열한째');
    const described = await last.evaluate((li) => { const id = li.getAttribute('aria-describedby') || li.querySelector('[aria-describedby]')?.getAttribute('aria-describedby'); const t = id && document.getElementById(id); return t ? t.textContent : null; });
    expect(described, '그 외 N개 접근 설명').toBe('여러 카테고리를 합친 항목');
    // 도넛 유지, 표로 보기는 제목 줄 오른쪽 글자 버튼, 표는 카드 안
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    const pos = await page.evaluate(() => { const tt = document.getElementById('donut-title'); const rg = document.createRange(); rg.selectNodeContents(tt); const t = rg.getBoundingClientRect(); const s = document.querySelector('#chart-donut details summary').getBoundingClientRect(); const c = document.querySelector('.donut-card').getBoundingClientRect(); return { sameRow: Math.abs((t.top + t.height / 2) - (s.top + s.height / 2)) < 14, right: s.left > t.right, inCard: s.right <= c.right && s.left >= c.left, h: s.height, w: s.width }; });
    expect(pos, JSON.stringify(pos)).toMatchObject({ sameRow: true, right: true, inCard: true });
    expect(pos.h).toBeGreaterThanOrEqual(43.5);
    await page.locator('#chart-donut details summary').click();
    await expect(page.locator('#chart-donut table')).toBeVisible();
    const tin = await page.evaluate(() => { const t = document.querySelector('#chart-donut table').getBoundingClientRect(); const c = document.querySelector('.donut-card').getBoundingClientRect(); const l = document.querySelector('#chart-donut .legend').getBoundingClientRect(); return { inCard: t.left >= c.left && t.right <= c.right, below: t.top >= l.top }; });
    expect(tin.inCard).toBe(true);
    // 전환
    await page.locator('#catview-income').click();
    await expect(page.locator('#donut-title')).toHaveText('카테고리별 수입');
    await expect(page.locator('#chart-donut .legend li')).toHaveCount(2);
    await page.locator('#catview-expense').click();
    await expect(page.locator('#donut-title')).toHaveText('카테고리별 지출');
    // 카테고리 관리 링크는 카드 맨 아래
    const link = await page.evaluate(() => { const l = document.querySelector('.donut-card a[href="#categories"]').getBoundingClientRect(); const c = document.querySelector('.donut-card').getBoundingClientRect(); const lg = document.querySelector('#chart-donut').getBoundingClientRect(); return { bottom: c.bottom - l.bottom, below: l.top >= lg.bottom - 1 }; });
    expect(link.below).toBe(true);
    expect(link.bottom).toBeLessThan(40);
    await page.locator('.donut-card a[href="#categories"]').click();
    await expect(page.locator('#panel-categories')).toBeVisible();
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-R22 인사이트 카드: 대시보드 월을 바꾸면 그 달 인사이트(요청 month 일치), 섹션 키·빈 문구·XSS 안전, 카테고리 카드 바로 아래', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => {
      for (const d of ['2026-06-01', '2026-07-01', '2026-08-01']) await income(api, '용돈', 100_000, d);
      await income(api, '용돈', 50_000, '2026-09-01');
      for (const d of ['2026-07-15', '2026-08-14', '2026-09-13']) await income(api, '부수입', 400_000, d, '<img src=x onerror=alert(1)>');
    } });
    const { page } = a;
    const reqs = [];
    page.on('request', (r) => { if (/\/api\/insights/.test(r.url())) reqs.push(new URL(r.url()).searchParams.get('month')); });
    await expect(page.locator('#insights .insight-income-missing')).toBeVisible();
    expect(await page.locator('#insights .insight-income-drop').count()).toBe(0); // 이번 달(10월)은 I1 없음
    await page.locator('#dash-prev').click();
    await expect(page.locator('#dash-month')).toHaveText('2026년 9월');
    await expect(page.locator('#insights .insight-income-drop')).toBeVisible();
    await expect(page.locator('#insights .insight-income-drop .insight-text')).toHaveText('용돈: 9월 수입 50,000원으로 평소 월 평균 100,000원보다 50% 적어요');
    expect(await page.locator('#insights .insight-income-missing').count()).toBe(0);
    expect(reqs, `insights 요청 month ${reqs}`).toContain('2026-09');
    // XSS: 글자 그대로
    await page.locator('#dash-next').click();
    await expect(page.locator('#insights .insight-income-missing')).toBeVisible();
    await expect(page.locator('#insights')).toContainText('<img src=x onerror=alert(1)>');
    expect(await page.locator('#insights img').count()).toBe(0);
    // 위치: 카테고리 카드 바로 아래
    const order = await page.evaluate(() => { const d = document.querySelector('.donut-card').getBoundingClientRect(); const i = document.querySelector('.insights-card').getBoundingClientRect(); const m = document.querySelector('#chart-monthly').closest('.card').getBoundingClientRect(); return { gap: i.top - d.bottom, beforeMonthly: i.bottom <= m.top + 1 }; });
    expect(order.gap).toBeGreaterThanOrEqual(0);
    expect(order.gap).toBeLessThan(40);
    expect(order.beforeMonthly).toBe(true);
    // 섹션 제목은 남기되 작게, 장식 아이콘은 aria-hidden
    const sec = await page.evaluate(() => ({ h3: [...document.querySelectorAll('#insights h3')].length, hidden: [...document.querySelectorAll('#insights .insight-icon')].every((e) => e.getAttribute('aria-hidden') === 'true'), fs: getComputedStyle(document.querySelector('#insights h3')).fontSize }));
    expect(sec.h3).toBeGreaterThan(0);
    expect(sec.hidden).toBe(true);
    // 빈 상태
    const e = await open(browser, testInfo, { hash: '#dashboard' });
    await expect(e.page.locator('#insights .hint')).toContainText('아직 알려드릴 내용이 없어요');
    expect(a.dialogs?.length || 0).toBe(0);
    await e.ctx.close();
    await a.ctx.close();
  });

  test('C-R23 월별 추이·카테고리 추이·표로 보기 동작, 6/12개월 전환, 가로 스크롤 없음', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => {
      for (let m = 5; m <= 10; m++) { const mm = String(m).padStart(2, '0'); await expense(api, '식비', 10000 + m * 1000, `2026-${mm}-03`); await income(api, '급여', 500000, `2026-${mm}-15`); }
    } });
    const { page } = a;
    for (const sel of ['#chart-monthly svg.chart-svg', '#chart-cat-trend svg.chart-svg', '#chart-donut svg.chart-svg']) await expect(page.locator(sel)).toBeVisible();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(6);
    await page.locator('#range-12').click();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
    await page.locator('#chart-monthly details summary').click();
    await expect(page.locator('#chart-monthly table')).toBeVisible();
    await page.locator('#chart-cat-trend details summary').click();
    await expect(page.locator('#chart-cat-trend table')).toBeVisible();
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 회귀 · 범위 · 스크린샷
test.describe('C-R24~C-R26 회귀·범위·스크린샷', () => {
  test('C-R25 변경 범위: src/backend·schema.sql·docs/api.md·tokens.css·components.css 변경 없음, 변경 파일은 허용 폴더 안', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    const tracked = git('status', '--porcelain', '--untracked-files=no', '--', 'src/backend', 'docs/api.md', 'src/frontend/public/css/tokens.css', 'src/frontend/public/css/components.css', 'src/frontend/office', 'src/frontend/public/js/theme-init.js').trim();
    expect(tracked, `금지 파일 변경: ${tracked}`).toBe('');
    expect(git('ls-files', '--others', '--exclude-standard', '--', 'src/backend', 'src/frontend/office').trim(), '금지 폴더의 새 파일').toBe('');
    const changed = git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
    const allowed = /^(src\/frontend\/public\/|src\/frontend\/test\/|e2e\/|docs\/|design_handoff_moneybook\/)/;
    const outside = changed.filter((f) => !allowed.test(f));
    expect(outside, `허용 폴더 밖 변경: ${outside}`).toEqual([]);
  });

  test('C-R26 화면별 스크린샷(기록·대시보드·내 정보 x 라이트·다크 x 360)을 docs/qa-shots-redesign/ 에 저장', async ({ browser }, testInfo) => {
    onlyMobile(testInfo);
    test.setTimeout(120_000);
    const dir = join(ROOT, 'docs', 'qa-shots-redesign');
    mkdirSync(dir, { recursive: true });
    const u = await createLoggedInUser('rdshot');
    for (const cat of ['아홉째']) await mkCat(u.api, 'expense', cat);
    const all = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', '아홉째'];
    for (const [i, c] of all.entries()) await expense(u.api, c, 80_000 - i * 6_000, `2026-10-${String(5 + (i % 10)).padStart(2, '0')}`, `${c} 메모`);
    await income(u.api, '급여', 2_500_000, '2026-10-02'); await income(u.api, '용돈', 100_000, '2026-10-03');
    for (const d of ['2026-07-02', '2026-08-01', '2026-08-31']) await income(u.api, '급여', 2_500_000, d, '급여');
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme, user: u, height: 800 });
      const { page } = a;
      await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, `record-${scheme}-360.png`) });
      await goHash(page, '#dashboard');
      await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
      await expect(page.locator('#insights .insight, #insights .hint').first()).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, `dashboard-${scheme}-360.png`), fullPage: true });
      await goHash(page, '#account');
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, `account-${scheme}-360.png`) });
      await a.ctx.close();
    }
  });

  test('시드 사용자 대시보드: 라이트 모드에서 카드·범례·인사이트가 겹치거나 잘리지 않는다(가로 스크롤 0, 카드 안 요소가 카드 밖으로 나가지 않음)', async ({ browser }, testInfo) => {
    test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요');
    const api = await newApi();
    expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
    const a = await open(browser, testInfo, { hash: '#dashboard', scheme: 'light', user: { api, account: { name: '' } } }).catch(() => null);
    if (!a) return;
    const { page } = a;
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    const bad = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll('#panel-dashboard .card')) {
        const c = card.getBoundingClientRect();
        for (const e of card.querySelectorAll('*')) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (e.closest('svg') && e.tagName !== 'svg') continue;
          if (r.right > c.right + 1 || r.left < c.left - 1) out.push(`${e.tagName}.${e.className && e.className.baseVal === undefined ? e.className : ''} ${r.left.toFixed(0)}-${r.right.toFixed(0)} card ${c.left.toFixed(0)}-${c.right.toFixed(0)}`);
        }
      }
      return out.slice(0, 5);
    });
    expect(bad).toEqual([]);
    await a.ctx.close();
  });
});
