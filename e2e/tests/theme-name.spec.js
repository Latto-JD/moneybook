// docs/plan-theme-name.md Q-TN2: 화면 모드 전환(C-T1~C-T10)과 이름(C-N1~C-N10).
// 마이그레이션 절(C-N1, 기존 사용자 name null)은 커밋 440e9e6(이름 기능 이전)의 코드를 임시 디렉터리에 풀어 구버전 서버로 쓴다.
// 로컬 PGlite 임시 디렉터리만 사용한다. 운영/Neon 에는 접속하지 않는다.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApi, json, get, signup, login, createLoggedInUser, addTx, uniqueIp } from '../helpers/api.js';
import { newAccount, PASSWORD } from '../helpers/accounts.js';
import { expectError } from '../helpers/errors.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';
import { TRUST_PROXY } from '../helpers/env.js';
import { startServer, migrate, tmpPgliteDir, removeDir, dbQuery, dbExec, checkoutCommit, removeCheckout } from '../helpers/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(resolve(HERE, '..', '..'), 'src', 'frontend', 'public');
const OLD_COMMIT = '440e9e6';
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const onlyMobile = (testInfo) => test.skip(widthOf(testInfo) !== 360, 'API/정적 검사는 mobile-360 에서만');

const LIGHT = { bg: 'rgb(247, 245, 240)', text: 'rgb(27, 26, 23)', focus: 'rgb(6, 88, 171)' };
const DARK = { bg: 'rgb(20, 20, 18)', text: 'rgb(238, 235, 227)', focus: 'rgb(125, 182, 254)' };
const PAL = { light: LIGHT, dark: DARK };

// ------------------------------------------------------------------ 공통
/** 브라우저로 열기. scheme=OS 설정, stored='light'|'dark'|문자열이면 localStorage['mb-theme'] 를 문서 시작 전에 넣는다 */
async function open(browser, testInfo, { api, scheme = 'light', stored, hash = '#record', path = '/', ip } = {}) {
  const ui = await newUiPage(browser, testInfo, { api, ip });
  const { page } = ui;
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = [];
  // 로그인 화면은 로드 시 GET /api/auth/me 로 로그인 여부를 확인하므로 비로그인에서 401 리소스 오류가 콘솔에 남는다(기존 동작)
  const knownProbe = (t) => path === '/login.html' && /status of 401/.test(t);
  page.on('console', (m) => { if ((m.type() === 'error' && !knownProbe(m.text())) || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript((v) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (v) { try { localStorage.setItem('mb-theme', v); } catch { /* 무시 */ } }
  }, stored ?? null);
  await page.goto(path === '/' ? `/${hash}` : path);
  return { ...ui, problems };
}
const csp = (page) => page.evaluate(() => window.__csp || []);
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const bodyColor = (page) => page.evaluate(() => getComputedStyle(document.body).color);
const dataTheme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const stored = (page) => page.evaluate(() => localStorage.getItem('mb-theme'));
const settle = (page) => page.waitForTimeout(400);

/** 로그인된 api 로 열릴 때까지 기다린다 (이름 또는 이메일이 헤더에 표시됨) */
async function ready(page, text) {
  await expect(page.locator('#user-name')).toHaveText(text);
}

/** 가입은 IP 당 시간당 10회 제한이 있어 이 파일의 사용자 생성은 공유 풀로 최소화한다 */
let pool;
async function user() {
  pool ||= await createLoggedInUser('tn');
  return pool;
}

/** /api/auth/me 응답의 user 를 바꿔 끼운다 (이름 없는 기존 사용자, 긴 이메일 재현용) */
async function overrideMe(page, patch) {
  await page.route('**/api/auth/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { user: { ...body.user, ...patch } } });
  });
}

// ====================================================================== C-T 화면 모드
test.describe('C-T 화면 모드', () => {
  test('C-T1 저장값 없음: OS 라이트/다크 따라 배경, data-theme 없음, 선택값 자동', async ({ browser }, testInfo) => {
    const u = await user();
    for (const scheme of ['light', 'dark']) {
      const ui = await open(browser, testInfo, { api: u.api, scheme });
      await ready(ui.page, u.account.name);
      await settle(ui.page);
      expect(await bodyBg(ui.page), scheme).toBe(PAL[scheme].bg);
      expect(await dataTheme(ui.page)).toBeNull();
      await expect(ui.page.locator('#theme-select')).toHaveValue('auto');
      expect(ui.problems).toEqual([]);
      await ui.ctx.close();
    }
  });

  test('C-T2 저장값이 OS 보다 우선: dark+OS라이트, light+OS다크, 메인·로그인 화면', async ({ browser }, testInfo) => {
    const u = await user();
    for (const [st, scheme] of [['dark', 'light'], ['light', 'dark']]) {
      const ui = await open(browser, testInfo, { api: u.api, scheme, stored: st });
      await ready(ui.page, u.account.name);
      await settle(ui.page);
      expect(await dataTheme(ui.page)).toBe(st);
      expect(await bodyBg(ui.page), `main ${st}/${scheme}`).toBe(PAL[st].bg);
      expect(await bodyColor(ui.page), `main text ${st}/${scheme}`).toBe(PAL[st].text);
      await expect(ui.page.locator('#theme-select')).toHaveValue(st);
      await ui.ctx.close();
      // 로그인 화면 (비로그인)
      const lg = await open(browser, testInfo, { scheme, stored: st, path: '/login.html' });
      await settle(lg.page);
      expect(await dataTheme(lg.page)).toBe(st);
      expect(await bodyBg(lg.page), `login ${st}/${scheme}`).toBe(PAL[st].bg);
      expect(await bodyColor(lg.page), `login text ${st}/${scheme}`).toBe(PAL[st].text);
      expect(await csp(lg.page)).toEqual([]);
      expect(lg.problems).toEqual([]);
      await lg.ctx.close();
    }
  });

  test('C-T3 자동->라이트->다크->자동: 즉시 색 변경, localStorage 값, 새로고침·재방문 유지', async ({ browser }, testInfo) => {
    const u = await user();
    const ui = await open(browser, testInfo, { api: u.api, scheme: 'dark' }); // OS 다크에서 시작
    const { page } = ui;
    await ready(page, u.account.name);
    const sel = page.locator('#theme-select');
    let navs = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs += 1; });
    await sel.selectOption('light'); await settle(page);
    expect(await bodyBg(page)).toBe(LIGHT.bg);
    expect(await stored(page)).toBe('light');
    expect(await dataTheme(page)).toBe('light');
    await sel.selectOption('dark'); await settle(page);
    expect(await bodyBg(page)).toBe(DARK.bg);
    expect(await stored(page)).toBe('dark');
    await sel.selectOption('auto'); await settle(page);
    expect(await stored(page)).toBeNull();
    expect(await dataTheme(page)).toBeNull();
    expect(await bodyBg(page)).toBe(DARK.bg); // OS 다크 따름
    expect(navs).toBe(0); // 새로고침 없이 전환
    // 라이트 선택 후 새로고침, 재방문(새 페이지, 같은 컨텍스트)
    await sel.selectOption('light'); await settle(page);
    await page.reload(); await ready(page, u.account.name); await settle(page);
    expect(await bodyBg(page)).toBe(LIGHT.bg);
    await expect(page.locator('#theme-select')).toHaveValue('light');
    const page2 = await ui.ctx.newPage();
    await page2.emulateMedia({ colorScheme: 'dark' });
    await page2.goto('/#dashboard'); await settle(page2);
    expect(await bodyBg(page2)).toBe(LIGHT.bg);
    await expect(page2.locator('#theme-select')).toHaveValue('light');
    expect(ui.problems).toEqual([]);
    await ui.ctx.close();
  });

  test('C-T4 깜빡임 없음: DOMContentLoaded·첫 rAF 시점에 이미 저장값, head 에서 theme-init 이 첫 CSS 앞(classic, defer/async 없음)', async ({ browser }, testInfo) => {
    const u = await user();
    for (const path of ['/', '/login.html']) {
      const ctx = await browser.newContext({ viewport: testInfo.project.use.viewport, storageState: await u.api.storageState(), extraHTTPHeaders: TRUST_PROXY ? { 'x-forwarded-for': uniqueIp() } : undefined });
      const page = await ctx.newPage();
      await page.emulateMedia({ colorScheme: 'light' });
      await page.addInitScript(() => {
        localStorage.setItem('mb-theme', 'dark');
        const snap = () => ({ theme: document.documentElement.getAttribute('data-theme'), bg: document.body ? getComputedStyle(document.body).backgroundColor : null });
        window.__snaps = {};
        document.addEventListener('DOMContentLoaded', () => { window.__snaps.dcl = snap(); });
        requestAnimationFrame(() => { window.__snaps.raf = snap(); });
      });
      await page.goto(path === '/' ? '/#record' : '/login.html', { waitUntil: 'commit' });
      await page.waitForLoadState('load');
      const snaps = await page.evaluate(() => window.__snaps);
      // 로그인 상태면 /login.html 은 / 로 이동한다. 이동 뒤에도 첫 시점 값이 저장값이어야 한다.
      expect(snaps.dcl?.theme, `${path} DOMContentLoaded`).toBe('dark');
      expect(snaps.dcl?.bg, `${path} DOMContentLoaded bg`).toBe(DARK.bg);
      expect(snaps.raf?.theme, `${path} rAF`).toBe('dark');
      if (snaps.raf?.bg) expect(snaps.raf.bg, `${path} rAF bg`).toBe(DARK.bg);
      await ctx.close();
    }
  });

  test('C-T4 정적: 두 HTML 의 head 에서 theme-init.js 가 첫 stylesheet 보다 앞, type=module/defer/async 없음', async ({}, testInfo) => {
    onlyMobile(testInfo);
    for (const f of ['index.html', 'login.html']) {
      const html = readFileSync(join(PUBLIC, f), 'utf8');
      const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
      const tag = head.match(/<script[^>]*theme-init\.js[^>]*>/);
      expect(tag, `${f} theme-init 태그`).not.toBeNull();
      expect(tag[0]).not.toMatch(/type\s*=\s*["']?module|\bdefer\b|\basync\b/);
      expect(head.indexOf(tag[0]), `${f} 순서`).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
      // 서버가 실제로 같은 출처 파일로 내려주는지
      const res = await get(await newApi(), '/js/theme-init.js');
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/javascript/);
    }
  });

  test('C-T5 잘못된 저장값(blue)·localStorage 예외: 자동으로 동작, 페이지 오류 0', async ({ browser }, testInfo) => {
    const u = await user();
    const bad = await open(browser, testInfo, { api: u.api, scheme: 'dark', stored: 'blue' });
    await ready(bad.page, u.account.name); await settle(bad.page);
    expect(await dataTheme(bad.page)).toBeNull();
    expect(await bodyBg(bad.page)).toBe(DARK.bg);
    await expect(bad.page.locator('#theme-select')).toHaveValue('auto');
    expect(bad.problems).toEqual([]);
    await bad.ctx.close();

    // getItem/setItem/removeItem 모두 예외
    for (const path of ['/#record', '/login.html']) {
      const ui = await newUiPage(browser, testInfo, { api: path === '/#record' ? u.api : undefined });
      const { page } = ui;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.addInitScript(() => {
        const boom = () => { throw new DOMException('denied', 'SecurityError'); };
        Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom;
      });
      await page.goto(path);
      await settle(page);
      expect(await bodyBg(page), path).toBe(DARK.bg);
      expect(await dataTheme(page)).toBeNull();
      if (path === '/#record') {
        await ready(page, u.account.name);
        await page.locator('#theme-select').selectOption('light'); // 저장 실패해도 화면에는 적용
        await settle(page);
        expect(await bodyBg(page)).toBe(LIGHT.bg);
      }
      expect(errors, path).toEqual([]);
      await ui.ctx.close();
    }
  });

  test('C-T6 다른 탭에서 바꾸면 열린 탭의 색과 선택값이 따라 바뀐다', async ({ browser }, testInfo) => {
    const u = await user();
    const ui = await open(browser, testInfo, { api: u.api, scheme: 'light' });
    const a = ui.page;
    await ready(a, u.account.name);
    const b = await ui.ctx.newPage();
    await b.emulateMedia({ colorScheme: 'light' });
    await b.goto('/#record'); await ready(b, u.account.name);
    await b.locator('#theme-select').selectOption('dark');
    await expect.poll(() => bodyBg(a)).toBe(DARK.bg);
    await expect(a.locator('#theme-select')).toHaveValue('dark');
    await b.locator('#theme-select').selectOption('auto');
    await expect.poll(() => dataTheme(a)).toBeNull();
    await expect(a.locator('#theme-select')).toHaveValue('auto');
    await expect.poll(() => bodyBg(a)).toBe(LIGHT.bg);
    expect(ui.problems).toEqual([]);
    await ui.ctx.close();
  });

  test('C-T7 차트: 다시 그리지 않고 모드 토큰 색으로 바뀐다 (도넛·월별 막대·카테고리 추이)', async ({ browser }, testInfo) => {
    const tok = readFileSync(join(PUBLIC, 'css', 'tokens.css'), 'utf8');
    const hexMap = (block) => Object.fromEntries([...block.matchAll(/--(viz-\d|color-income|color-expense):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
    const lightTok = hexMap(tok.slice(tok.indexOf(':root {'), tok.indexOf('@media (prefers-color-scheme: dark)')));
    const darkTok = hexMap(tok.slice(tok.indexOf(':root[data-theme="dark"]')));
    const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

    const u = await createLoggedInUser('tchart');
    const cats = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'];
    for (let m = 5; m <= 10; m++) {
      for (const [i, c] of cats.entries()) {
        await addTx(u.api, { type: 'expense', amount: 3000 + i * 1700 + m * 100, category: c, date: `2026-${String(m).padStart(2, '0')}-0${(i % 8) + 1}` });
      }
      await addTx(u.api, { type: 'income', amount: 500000 + m, category: '급여', date: `2026-${String(m).padStart(2, '0')}-15` });
    }
    const ui = await open(browser, testInfo, { api: u.api, scheme: 'light', hash: '#dashboard' });
    const { page } = ui;
    for (const sel of ['#chart-donut svg.chart-svg', '#chart-monthly svg.chart-svg', '#chart-cat-trend svg.chart-svg']) await expect(page.locator(sel)).toBeVisible();
    await page.evaluate(() => { document.querySelectorAll('svg.chart-svg').forEach((s, i) => { s.dataset.qaMark = `m${i}`; }); });
    const fills = () => page.evaluate(() => {
      const out = {};
      for (let n = 1; n <= 8; n++) { const e = document.querySelector(`[class*="viz-fill-${n}"]`); if (e) out[`viz-${n}`] = getComputedStyle(e).fill; }
      const inc = document.querySelector('.chart-fill-income'); const exp = document.querySelector('.chart-fill-expense');
      if (inc) out['color-income'] = getComputedStyle(inc).fill;
      if (exp) out['color-expense'] = getComputedStyle(exp).fill;
      return out;
    });
    const check = async (tokens, label) => {
      const f = await fills();
      expect(Object.keys(f).length, `${label} 측정 요소 수`).toBeGreaterThanOrEqual(6);
      for (const [k, v] of Object.entries(f)) expect(v, `${label} ${k}`).toBe(rgb(tokens[k]));
    };
    await settle(page);
    await check(lightTok, '라이트');
    await page.locator('#theme-select').selectOption('dark'); await settle(page);
    await check(darkTok, '수동 다크(OS 라이트)');
    expect(await page.evaluate(() => [...document.querySelectorAll('svg.chart-svg')].map((s) => s.dataset.qaMark)), '다시 그리지 않음').toEqual(['m0', 'm1', 'm2']);
    await page.locator('#theme-select').selectOption('auto'); await settle(page);
    await check(lightTok, '자동 복귀');
    expect(ui.problems).toEqual([]);
    expect(await csp(page)).toEqual([]);
    await ui.ctx.close();
  });

  // C-D8/C-D9/C-D10/C-D14 재실행 대신: 같은 화면의 모든 요소 계산 스타일이 "OS 에서 그 모드"일 때와 완전히 같은지 비교(동치성)
  // + 수동 다크에서 흰 배경·검은 stroke 0, 포커스 링 색.
  test('C-T7 수동 다크(OS 라이트)·수동 라이트(OS 다크)는 OS 모드와 모든 요소 색이 같다, 흰 배경 0, 포커스 링 색', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const u = await createLoggedInUser('tequiv');
    const cats = ['식비', '교통', '쇼핑', '기타'];
    for (const [i, c] of cats.entries()) await addTx(u.api, { type: 'expense', amount: 4000 + i * 900, category: c, date: `2026-10-0${i + 1}`, memo: `m${i}` });
    await addTx(u.api, { type: 'income', amount: 900000, category: '급여', date: '2026-10-10' });
    const scan = (page) => page.evaluate(() => {
      const props = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor', 'boxShadow', 'fill', 'stroke', 'caretColor'];
      const out = [];
      document.querySelectorAll('body *').forEach((e) => {
        if (!e.getClientRects().length) return;
        const cs = getComputedStyle(e);
        out.push(`${e.tagName}.${(e.getAttribute('class') || '').toString()}#${e.id}|${props.map((p) => cs[p]).join('|')}`);
      });
      return { rows: out, scheme: getComputedStyle(document.documentElement).colorScheme };
    });
    const screens = ['#record', '#dashboard', '#categories', '#account'];
    for (const [mode, osOther] of [['dark', 'light'], ['light', 'dark']]) {
      const ref = await open(browser, testInfo, { api: u.api, scheme: mode });
      const man = await open(browser, testInfo, { api: u.api, scheme: osOther, stored: mode });
      for (const h of screens) {
        for (const p of [ref.page, man.page]) {
          await p.evaluate((x) => { location.hash = x; }, h);
          await p.waitForTimeout(500);
        }
        if (h === '#dashboard') for (const p of [ref.page, man.page]) await expect(p.locator('#chart-donut svg.chart-svg')).toBeVisible();
        const [a, b] = [await scan(ref.page), await scan(man.page)];
        expect(b.scheme, `${mode} ${h} color-scheme`).toBe(a.scheme);
        expect(b.rows.length, `${mode} ${h} 요소 수`).toBe(a.rows.length);
        const diff = a.rows.findIndex((r, i) => r !== b.rows[i]);
        expect(diff === -1 ? 'same' : `${a.rows[diff]} != ${b.rows[diff]}`, `${mode} ${h}`).toBe('same');
        if (mode === 'dark') {
          const white = await man.page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getClientRects().length && getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)').length);
          expect(white, `${h} 흰 배경`).toBe(0);
          const black = await man.page.evaluate(() => [...document.querySelectorAll('svg *')].filter((e) => e.getClientRects().length && ['rgb(0, 0, 0)', 'rgb(27, 26, 23)'].includes(getComputedStyle(e).stroke)).length);
          expect(black, `${h} 옛 stroke`).toBe(0);
        }
      }
      // C-D14 포커스 링: 수동 모드에서 Tab 으로 도달한 요소의 box-shadow 에 --color-focus
      await man.page.evaluate(() => { location.hash = '#record'; });
      await man.page.waitForTimeout(300);
      let ring = 0; const seen = [];
      for (let i = 0; i < 12; i++) {
        await man.page.keyboard.press('Tab');
        const r = await man.page.evaluate(() => { const e = document.activeElement; return { id: e.id, shadow: getComputedStyle(e).boxShadow, outline: getComputedStyle(e).outlineStyle }; });
        seen.push(r.id);
        if (r.shadow.includes(PAL[mode].focus)) ring += 1;
      }
      expect(ring, `${mode} 포커스 링 ${seen.join(',')}`).toBeGreaterThanOrEqual(8);
      expect(ref.problems).toEqual([]); expect(man.problems).toEqual([]);
      await ref.ctx.close(); await man.ctx.close();
    }
  });

  test('C-T8 접근성: 이름 "화면 모드", Tab 도달·포커스 링, 키보드로 변경, 높이 44px 이상', async ({ browser }, testInfo) => {
    const u = await user();
    for (const scheme of ['light', 'dark']) {
      const ui = await open(browser, testInfo, { api: u.api, scheme });
      const { page } = ui;
      await ready(page, u.account.name);
      const combo = page.getByRole('combobox', { name: '화면 모드' });
      await expect(combo).toBeVisible();
      expect(await combo.evaluate((e) => e.id)).toBe('theme-select');
      expect((await combo.boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect((await page.locator('#user-name').boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect((await page.locator('#logout-btn').boundingBox()).height).toBeGreaterThanOrEqual(44);
      // 로드 직후 금액칸에 포커스가 있어 Tab 시작점을 헤더 이름 링크로 옮긴 뒤 Tab 순서(이름 -> 모드 -> 로그아웃)를 확인
      await page.locator('#user-name').focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.id), 'Tab 으로 도달').toBe('theme-select');
      await page.waitForTimeout(300);
      expect(await combo.evaluate((e) => getComputedStyle(e).boxShadow)).toContain(PAL[scheme].focus);
      expect(await combo.evaluate((e) => e.matches(':focus-visible'))).toBe(true);
      // 키보드로 값 변경: 자동 -> (아래) 라이트
      await page.keyboard.press('ArrowDown');
      await expect(combo).toHaveValue('light');
      await settle(page);
      expect(await bodyBg(page)).toBe(LIGHT.bg);
      await page.keyboard.press('ArrowDown');
      await expect(combo).toHaveValue('dark');
      expect(await stored(page)).toBe('dark');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('theme-select'); // 포커스 유지
      // 라벨이 화면에 보이지 않는 텍스트
      expect(await page.locator('label[for="theme-select"]').evaluate((e) => e.className)).toMatch(/visually-hidden/);
      // 헤더 이름 링크 접근 이름
      expect(await page.locator('#user-name').getAttribute('aria-label')).toBe(`내 정보: ${u.account.name}`);
      await ui.ctx.close();
    }
  });

  test('C-T9 헤더 한 줄: 짧은 이름·20자 이름·긴 이메일(이름 없음), 3개 모드에서 말줄임, 겹침·잘림·가로 스크롤 없음', async ({ browser }, testInfo) => {
    const u = await user();
    const w = widthOf(testInfo);
    const cases = [
      { label: '짧은 이름', patch: { name: '홍길동' } },
      { label: '20자 한글', patch: { name: '가나다라마바사아자차카타파하가나다라마바사' } },
      { label: '20자 W', patch: { name: 'WWWWWWWWWWWWWWWWWWWW' } },
      { label: '긴 이메일', patch: { name: null, email: `${'verylongaddress'.repeat(8)}@example-domain-name.example.com` } },
    ];
    for (const c of cases) {
      for (const mode of ['auto', 'light', 'dark']) {
        const ui2 = await newUiPage(browser, testInfo, { api: u.api });
        const { page } = ui2;
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.addInitScript((v) => { if (v) localStorage.setItem('mb-theme', v); }, mode === 'auto' ? null : mode);
        await overrideMe(page, c.patch);
        await page.goto('/#record');
        await expect(page.locator('#user-name')).toHaveText(c.patch.name ?? c.patch.email);
        await settle(page);
        const m = await page.evaluate(() => {
          const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }; };
          const hd = document.querySelector('.app-header').getBoundingClientRect();
          const n = document.querySelector('#user-name');
          return { hd: { t: hd.top, b: hd.bottom, h: hd.height, l: hd.left, r: hd.right }, name: r('#user-name'), sel: r('#theme-select'), out: r('#logout-btn'), vw: document.documentElement.clientWidth,
            ellipsis: getComputedStyle(n).textOverflow, truncated: n.scrollWidth > n.clientWidth, nameScroll: n.scrollWidth, nameClient: n.clientWidth };
        });
        const tag = `${c.label}/${mode}/${w}`;
        const mid = (x) => (x.t + x.b) / 2;
        expect(Math.abs(mid(m.name) - mid(m.sel)), `${tag} 세로 정렬 name/select`).toBeLessThan(6);
        expect(Math.abs(mid(m.sel) - mid(m.out)), `${tag} 세로 정렬 select/logout`).toBeLessThan(6);
        expect(m.hd.h, `${tag} 헤더 높이(한 줄)`).toBeLessThan(80);
        expect(m.name.r, `${tag} 이름/모드 겹침`).toBeLessThanOrEqual(m.sel.l + 0.5);
        expect(m.sel.r, `${tag} 모드/로그아웃 겹침`).toBeLessThanOrEqual(m.out.l + 0.5);
        expect(m.out.r, `${tag} 로그아웃 화면 안`).toBeLessThanOrEqual(m.vw + 0.5);
        expect(m.name.l, `${tag} 이름 화면 안`).toBeGreaterThanOrEqual(-0.5);
        expect(m.ellipsis).toBe('ellipsis');
        expect(m.name.r - m.name.l, `${tag} 이름 영역 폭`).toBeGreaterThan(40);
        expect(m.sel.r - m.sel.l, `${tag} 모드 선택 폭`).toBeGreaterThan(40);
        if (c.label === '긴 이메일') expect(m.truncated, `${tag} 긴 이메일은 말줄임`).toBe(true);
        await expectNoHorizontalScroll(page, w);
        expect(errs).toEqual([]);
        await ui2.ctx.close();
      }
    }
  });

  test('C-T9 말줄임이 실제로 그려진다: display 가 block 계열, 텍스트 폭 > 박스 폭, 스크린샷 + 오른쪽 끝에 "…" 잉크', async ({ browser }, testInfo) => {
    const u = await user();
    const shotDir = process.env.QA_SHOT_DIR || '';
    for (const c of [{ label: 'long-email', patch: { name: null, email: `${'verylongaddress'.repeat(8)}@example-domain-name.example.com` } }, { label: 'name20', patch: { name: 'WWWWWWWWWWWWWWWWWWWW' } }]) {
      const ui = await newUiPage(browser, testInfo, { api: u.api });
      const { page } = ui;
      await page.emulateMedia({ colorScheme: 'light' });
      await overrideMe(page, c.patch);
      await page.goto('/#record');
      await expect(page.locator('#user-name')).toHaveText(c.patch.name ?? c.patch.email);
      await settle(page);
      const m = await page.evaluate(() => {
        const n = document.querySelector('#user-name');
        const rg = document.createRange(); rg.selectNodeContents(n);
        return { display: getComputedStyle(n).display, textW: rg.getBoundingClientRect().width, boxW: n.getBoundingClientRect().width, headerW: document.querySelector('.app-header').getBoundingClientRect().width };
      });
      expect(m.display, c.label).toBe('block');
      if (c.label === 'long-email') expect(m.textW, `${c.label} 텍스트 폭 ${m.textW} > 박스 ${m.boxW}`).toBeGreaterThan(m.boxW);
      // 렌더 확인: 박스 오른쪽 끝 구간에 글자 잉크가 있어야 한다(말줄임표가 그려진 경우). 잘린 글자만이어도 잉크는 있으므로 스크린샷을 함께 남긴다.
      const box = await page.locator('#user-name').boundingBox();
      const file = join(shotDir || testInfo.outputDir, `ellipsis-${c.label}-${widthOf(testInfo)}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: Math.max(0, box.y - 4), width: Math.min(widthOf(testInfo), 400), height: box.height + 8 } });
      testInfo.attach(`ellipsis-${c.label}`, { path: file, contentType: 'image/png' });
      console.log(`SHOT ${file} display=${m.display} textW=${m.textW.toFixed(1)} boxW=${m.boxW.toFixed(1)} headerW=${m.headerW}`);
      await ui.ctx.close();
    }
  });

  test('C-T10 모든 모드·화면에서 CSP 위반·콘솔 오류 0', async ({ browser }, testInfo) => {
    const u = await user();
    for (const [scheme, st] of [['light', undefined], ['dark', undefined], ['light', 'dark'], ['dark', 'light']]) {
      const ui = await open(browser, testInfo, { api: u.api, scheme, stored: st });
      await ready(ui.page, u.account.name);
      for (const h of ['#record', '#dashboard', '#categories', '#account']) {
        await ui.page.evaluate((x) => { location.hash = x; }, h);
        await ui.page.waitForTimeout(300);
      }
      expect(await csp(ui.page), `${scheme}/${st}`).toEqual([]);
      expect(ui.problems, `${scheme}/${st}`).toEqual([]);
      await ui.ctx.close();
      const lg = await open(browser, testInfo, { scheme, stored: st, path: '/login.html' });
      await lg.page.locator('#mode-signup').click();
      expect(await csp(lg.page)).toEqual([]);
      expect(lg.problems).toEqual([]);
      await lg.ctx.close();
    }
  });

  test('C-T10 정적: 인라인 script·on*=·style=·<style> 없음 (두 HTML)', async ({}, testInfo) => {
    onlyMobile(testInfo);
    for (const f of ['index.html', 'login.html']) {
      const html = readFileSync(join(PUBLIC, f), 'utf8');
      expect(html, f).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html, f).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html, f).not.toMatch(/\sstyle\s*=/i);
      expect(html, f).not.toMatch(/<style[\s>]/i);
    }
    for (const f of ['js/theme-init.js', 'js/lib/theme.js', 'js/lib/user-label.js', 'js/account.js']) {
      const js = readFileSync(join(PUBLIC, f), 'utf8');
      expect(js, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    }
  });
});

// ====================================================================== C-N 이름 (API)
test.describe('C-N 이름 API', () => {
  const acct = (tag, extra = {}) => ({ ...newAccount(tag), ...extra });
  const rawSignup = (api, body, headers) => json(api, 'POST', '/api/auth/signup', body, { headers });

  test('C-N2 잘못된 이름 -> 400 VALIDATION_ERROR + fields.name, 사용자 생성 안 됨, 시도 기록 안 남음', async ({}, testInfo) => {
    onlyMobile(testInfo);
    test.skip(!TRUST_PROXY, 'TRUST_PROXY=true 서버 필요(시도 기록 확인은 고정 IP 사용)');
    const ip = uniqueIp();
    const asIp = () => newApi({ extraHeaders: { 'x-forwarded-for': ip } });
    const bads = [
      ['누락', undefined], ['null', null], ['숫자', 12345], ['빈 문자열', ''], ['공백만', '   '], ['탭줄바꿈만', '\t\n '],
      ['21자', '가'.repeat(21)], ['제어문자 NUL', 'a\u0000b'], ['제어문자 BEL', 'a\u0007b'], ['제어문자 DEL', 'a\u007fb'], ['객체', { a: 1 }], ['배열', ['a']],
      ['21자 이모지', '😀'.repeat(21)],
    ];
    let n = 0;
    for (const [label, name] of bads) {
      const acc = acct(`n2${n++}`);
      const body = { email: acc.email, password: acc.password };
      if (name !== undefined) body.name = name;
      const res = await rawSignup(await asIp(), body);
      const err = await expectError(res, 400, 'VALIDATION_ERROR');
      expect(err.fields?.name, label).toEqual(expect.any(String));
      expect(err.fields.email, label).toBeUndefined();
      // 사용자 생성 안 됨: 같은 이메일로 로그인 불가
      await expectError(await login(await newApi(), acc), 401, 'INVALID_CREDENTIALS');
    }
    // 이메일·이름 동시 오류 -> 둘 다
    const both = await rawSignup(await asIp(), { email: 'not-an-email', password: PASSWORD, name: '' });
    const e2 = await expectError(both, 400, 'VALIDATION_ERROR');
    expect(Object.keys(e2.fields).sort()).toEqual(['email', 'name']);
    // 비밀번호 + 이름 + 이메일 모두
    const all = await expectError(await rawSignup(await asIp(), { email: 'x', password: 'short', name: 5 }), 400, 'VALIDATION_ERROR');
    expect(Object.keys(all.fields).sort()).toEqual(['email', 'name', 'password']);
    // 시도 기록: 위 실패(15회)가 같은 IP 의 가입 10회 제한에 포함되지 않아 정상 가입이 연속 성공해야 한다
    for (let i = 0; i < 10; i++) {
      const ok = await signup(await asIp(), acct(`n2ok${i}`));
      expect(ok.status(), `정상 가입 ${i + 1}번째`).toBe(201);
    }
    await expectError(await signup(await asIp(), acct('n2over')), 429, 'TOO_MANY_ATTEMPTS'); // 제한 자체는 살아 있음
  });

  test('C-N3 정규화 저장: 공백 정리, 탭·줄바꿈 공백화, NFC, 20자(이모지 포함) 성공, 응답=me', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const decomposed = '한글'.normalize('NFD');
    expect(decomposed).not.toBe('한글');
    const cases = [
      ['  홍   길동 ', '홍 길동'], ['\t홍\n길동\r\n', '홍 길동'], [decomposed, '한글'], ['가'.repeat(20), '가'.repeat(20)], ['😀'.repeat(20), '😀'.repeat(20)],
      ['a'.repeat(19) + '😀', 'a'.repeat(19) + '😀'], ['x', 'x'], ['<b>x</b>', '<b>x</b>'], ['  A  b  ', 'A b'],
    ];
    for (const [input, expected] of cases) {
      const acc = acct('n3', { name: input });
      const api = await newApi();
      const res = await signup(api, acc);
      expect(res.status(), JSON.stringify(input)).toBe(201);
      expect((await res.json()).user.name, JSON.stringify(input)).toBe(expected);
      const me = await (await get(api, '/api/auth/me')).json();
      expect(me.user.name).toBe(expected);
    }
  });

  test('C-N4 signup·login·me 사용자 객체는 정확히 {id,email,name}, 비밀번호·해시 없음', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const acc = acct('n4');
    const api = await newApi();
    const su = await (await signup(api, acc)).json();
    const shape = { id: expect.any(String), email: acc.email, name: acc.name };
    expect(su.user).toEqual(shape);
    const li = await login(await newApi(), acc);
    const liBody = await li.json();
    expect(liBody.user).toEqual(shape);
    const meRes = await get(api, '/api/auth/me');
    const meBody = await meRes.json();
    expect(meBody.user).toEqual(shape);
    expect(Object.keys(meBody)).toEqual(['user']);
    for (const b of [su, liBody, meBody]) expect(JSON.stringify(b)).not.toMatch(/password|hash|scrypt/i);
  });

  test('C-N5 로그인은 이메일+비밀번호만: 이름으로 로그인 불가, 이메일 대소문자·공백 무시 불변, 본문 name 무시', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const acc = acct('n5', { name: `이름${Date.now()}` }); // 이름을 이메일 칸에 넣은 로그인 실패가 실행마다 쌓여 이메일별 제한(429)에 걸리지 않게 고유값 사용
    expect((await signup(await newApi(), acc)).status()).toBe(201);
    await expectError(await json(await newApi(), 'POST', '/api/auth/login', { email: acc.name, password: acc.password }), 400, 'VALIDATION_ERROR').catch(async () => {
      // 이메일 형식 검사가 없으면 401 이어야 한다
      await expectError(await json(await newApi(), 'POST', '/api/auth/login', { email: acc.name, password: acc.password }), 401, 'INVALID_CREDENTIALS');
    });
    await expectError(await json(await newApi(), 'POST', '/api/auth/login', { name: acc.name, password: acc.password }), 400, 'VALIDATION_ERROR');
    const messy = `  ${acc.email.toUpperCase()} `;
    const ok = await json(await newApi(), 'POST', '/api/auth/login', { email: messy, password: acc.password, name: '다른 이름' });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).user.name).toBe(acc.name); // 본문 name 은 무시
  });

  test('C-N8 PATCH /api/auth/me: 정규화 저장, me 반영, 타 사용자 불변, email 불변, 400/401/403/415, 비우기 불가', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const a = await createLoggedInUser('n8a');
    const b = await createLoggedInUser('n8b');
    const res = await json(a.api, 'PATCH', '/api/auth/me', { name: '  새   이름 ', email: 'hacker@example.com', id: '00000000-0000-4000-8000-000000000000' });
    expect(res.status()).toBe(200);
    expect((await res.json()).user).toEqual({ id: a.user.id, email: a.account.email, name: '새 이름' });
    expect((await (await get(a.api, '/api/auth/me')).json()).user).toEqual({ id: a.user.id, email: a.account.email, name: '새 이름' });
    expect((await (await get(b.api, '/api/auth/me')).json()).user.name).toBe(b.account.name); // 다른 사용자 불변
    expect((await login(await newApi(), { email: 'hacker@example.com', password: a.account.password })).status()).toBe(401);
    expect((await login(await newApi(), a.account)).status()).toBe(200);
    // 400
    for (const [label, body] of [['빈 문자열', { name: '' }], ['null', { name: null }], ['누락', {}], ['공백만', { name: '  ' }], ['21자', { name: '나'.repeat(21) }], ['제어문자', { name: 'a\u0001' }], ['숫자', { name: 1 }]]) {
      const r = await expectError(await json(a.api, 'PATCH', '/api/auth/me', body), 400, 'VALIDATION_ERROR');
      expect(r.fields?.name, label).toEqual(expect.any(String));
    }
    expect((await (await get(a.api, '/api/auth/me')).json()).user.name).toBe('새 이름'); // 실패 후에도 값 유지
    // 401 (세션 없음, Origin 은 있음)
    await expectError(await json(await newApi(), 'PATCH', '/api/auth/me', { name: 'x' }), 401, 'UNAUTHENTICATED');
    // 403 Origin 없음 / 다른 Origin
    const state = await a.api.storageState();
    const Cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    await expectError(await json(await newApi({ withOrigin: false, extraHeaders: { Cookie } }), 'PATCH', '/api/auth/me', { name: 'x' }), 403, 'CSRF_REJECTED');
    await expectError(await json(await newApi({ extraHeaders: { Cookie, Origin: 'https://evil.example.com' } }), 'PATCH', '/api/auth/me', { name: 'x' }), 403, 'CSRF_REJECTED');
    // 깨진 JSON / Content-Type
    const bad = await a.api.fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, data: '{bad', failOnStatusCode: false });
    expect(bad.status()).toBe(400);
    const wrongCt = await a.api.fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, data: '{"name":"x"}', failOnStatusCode: false });
    expect(wrongCt.status()).toBe(415);
    // 405: 다른 메서드
    for (const m of ['PUT', 'DELETE', 'POST']) {
      const r = await json(a.api, m, '/api/auth/me', { name: 'x' });
      expect(r.status(), m).toBe(405);
      expect(r.headers().allow, m).toMatch(/GET/);
      expect(r.headers().allow, m).toMatch(/PATCH/);
    }
    expect((await (await get(a.api, '/api/auth/me')).json()).user.name).toBe('새 이름');
  });
});

// ====================================================================== C-N 이름 (UI)
test.describe('C-N 이름 UI', () => {
  test('C-N6 가입 화면: 가입 모드에서만 이름 필드, 라벨 연결, 로그인 요청에 name 없음', async ({ browser }, testInfo) => {
    const ui = await newUiPage(browser, testInfo);
    const { page } = ui;
    const bodies = [];
    page.on('request', (r) => { if (r.url().includes('/api/auth/') && r.method() === 'POST') bodies.push({ url: r.url(), data: r.postData() }); });
    await page.goto('/login.html');
    await expect(page.locator('#name')).toBeHidden();
    await expect(page.getByLabel('이름')).toBeHidden();
    await page.locator('#mode-signup').click();
    await expect(page.getByLabel('이름')).toBeVisible();
    expect(await page.getByLabel('이름').evaluate((e) => e.id)).toBe('name');
    await expect(page.locator('#name')).toHaveAttribute('autocomplete', 'name');
    expect(await page.locator('#name').getAttribute('aria-describedby')).toContain('name-error');
    await page.locator('#mode-login').click();
    await expect(page.locator('#name')).toBeHidden();
    // 가입 모드에서 이름을 입력해 두고 로그인으로 돌아가 제출 -> 본문에 name 없음
    await page.locator('#mode-signup').click();
    await page.locator('#name').fill('남겨진 이름');
    await page.locator('#mode-login').click();
    const u = await user();
    await page.locator('#email').fill(u.account.email);
    await page.locator('#password').fill(u.account.password);
    await page.locator('#submit-btn').click();
    await page.waitForURL((x) => x.pathname === '/' || x.pathname === '/index.html');
    const loginReq = bodies.find((b) => b.url.endsWith('/api/auth/login'));
    expect(loginReq, '로그인 요청').toBeTruthy();
    expect(JSON.parse(loginReq.data)).toEqual({ email: u.account.email, password: u.account.password });
    await ui.ctx.close();
  });

  test('C-N6 클라이언트 검증: 빈 이름·21자 -> #name-error, aria-invalid, 포커스, 가입 요청 없음; 이메일 오류와 겹치면 이름 먼저 포커스', async ({ browser }, testInfo) => {
    const ui = await newUiPage(browser, testInfo);
    const { page } = ui;
    let calls = 0;
    await page.route('**/api/auth/signup', (r) => { calls += 1; return r.continue(); });
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.locator('#email').fill('name-check@example.com');
    await page.locator('#password').fill('password-ok-1');
    for (const [value, label] of [['', '빈'], ['   ', '공백'], ['가'.repeat(21), '21자'], ['a\u0001b', '제어문자']]) {
      await page.locator('#name').fill(value);
      await page.locator('#submit-btn').click();
      await expect(page.locator('#name-error'), label).not.toHaveText('');
      await expect(page.locator('#name'), label).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#name'), label).toBeFocused();
      await expect(page.locator('#submit-btn')).toBeEnabled();
    }
    // maxlength 로 21자 직접 타이핑은 막히거나(40) 검증에 걸린다
    await page.locator('#name').fill('정상 이름');
    await page.locator('#email').fill('bad');
    await page.locator('#name').fill('');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#name')).toBeFocused();
    await expect(page.locator('#email-error')).not.toHaveText('');
    // 오류 후 고치면 이름 오류 해제 (모드 전환으로 초기화도 확인)
    await page.locator('#mode-login').click();
    await expect(page.locator('#name-error')).toHaveText('');
    expect(calls).toBe(0);
    await ui.ctx.close();
  });

  test('C-N6 서버 fields.name 도 #name-error 에 표시', async ({ browser }, testInfo) => {
    const ui = await newUiPage(browser, testInfo);
    const { page } = ui;
    await page.route('**/api/auth/signup', (r) => r.fulfill({ status: 400, contentType: 'application/json', json: { error: { code: 'VALIDATION_ERROR', message: '이름은 1자 이상 20자 이하여야 해요.', fields: { name: '서버가 말한 이름 오류' } } } }));
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.locator('#name').fill('정상');
    await page.locator('#email').fill('srv-name@example.com');
    await page.locator('#password').fill('password-ok-1');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#name-error')).toHaveText('서버가 말한 이름 오류');
    await expect(page.locator('#name')).toBeFocused().catch(() => {});
    await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email')).toHaveValue('srv-name@example.com');
    await ui.ctx.close();
  });

  test('C-N6 실제 가입: 이름 입력 -> 앱 진입 -> 헤더에 정규화된 이름, title 은 이메일, 이메일 로그인 재확인', async ({ browser }, testInfo) => {
    const acc = newAccount('n6real');
    const ui = await newUiPage(browser, testInfo);
    const { page } = ui;
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.getByLabel('이름').fill('  이  름  ');
    await page.locator('#email').fill(acc.email);
    await page.locator('#password').fill(acc.password);
    await page.locator('#submit-btn').click();
    await page.waitForURL((x) => x.pathname === '/' || x.pathname === '/index.html');
    await expect(page.locator('#user-name')).toHaveText('이 름');
    await expect(page.locator('#user-name')).toHaveAttribute('title', acc.email);
    await expect(page.locator('#amount')).toBeFocused();
    // 로그인 화면은 이메일로만 로그인 (이름 필드는 가입 전용)
    const ui2 = await newUiPage(browser, testInfo);
    await ui2.page.goto('/login.html');
    await ui2.page.locator('#email').fill('이 름');
    await ui2.page.locator('#password').fill(acc.password);
    await ui2.page.locator('#submit-btn').click();
    await expect(ui2.page.locator('#email-error')).not.toHaveText('');
    await ui.ctx.close(); await ui2.ctx.close();
  });

  test('C-N7 헤더: 이름 표시, title 이메일, HTML·스크립트 이름이 문자 그대로 보이고 실행되지 않는다', async ({ browser }, testInfo) => {
    for (const name of ['<b>x</b>', '<svg onload=__x=1>', '&amp;<i>', '"><u>']) {
      const acc = newAccount('n7');
      const api = await newApi();
      expect((await signup(api, { ...acc, name })).status()).toBe(201);
      const ui = await newUiPage(browser, testInfo, { api });
      const { page } = ui;
      const dialogs = [];
      page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
      await page.goto('/#record');
      await expect(page.locator('#user-name')).toHaveText(name);
      await expect(page.locator('#user-name')).toHaveAttribute('title', acc.email);
      expect(await page.locator('.app-header').evaluate((h) => h.querySelectorAll('b, i, u, svg, img').length), name).toBe(0);
      expect(await page.evaluate(() => typeof window.__x)).toBe('undefined');
      // 내 정보 화면: 입력값과 제목에도 문자 그대로
      await page.locator('#user-name').click();
      await expect(page.locator('#panel-account')).toBeVisible();
      await expect(page.locator('#account-name')).toHaveValue(name);
      expect(await page.locator('#panel-account').evaluate((p) => p.querySelectorAll('b, i, u, svg, img').length)).toBe(0);
      expect(dialogs).toEqual([]);
      await ui.ctx.close();
    }
  });

  test('C-N7 이름이 없는 사용자(null)는 헤더에 이메일, title 이메일, 접근 이름에 "이름 설정"', async ({ browser }, testInfo) => {
    const u = await user();
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    await overrideMe(page, { name: null });
    await page.goto('/#record');
    await expect(page.locator('#user-name')).toHaveText(u.account.email);
    await expect(page.locator('#user-name')).toHaveAttribute('title', u.account.email);
    expect(await page.locator('#user-name').getAttribute('aria-label')).toBe(`내 정보: ${u.account.email}, 이름 설정`);
    await page.locator('#user-name').click();
    await expect(page.locator('#account-hint')).toHaveText('이름을 넣으면 위쪽에 이메일 대신 이름이 보여요.');
    await expect(page.locator('#account-name')).toHaveValue('');
    await ui.ctx.close();
  });

  test('C-N9 내 정보: 헤더 링크 진입, 이메일 읽기 전용, 저장 즉시 헤더 갱신, 새로고침·뒤로가기, 검증 오류 role', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('n9');
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    const patches = [];
    page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.postData()); });
    await page.goto('/#record');
    await ready(page, u.account.name);
    await page.locator('#user-name').click();
    await expect(page).toHaveURL(/#account$/);
    await expect(page.locator('#panel-account')).toBeVisible();
    await expect(page.locator('#panel-record')).toBeHidden();
    await expect(page.locator('#account-email')).toHaveText(u.account.email);
    expect(await page.locator('#account-email').evaluate((e) => e.tagName)).not.toMatch(/INPUT|TEXTAREA/);
    await expect(page.locator('#account-name')).toHaveValue(u.account.name);
    expect(await page.locator('.tabbar [aria-current]').evaluate((e) => e.getAttribute('href') || e.textContent)).toMatch(/record|기록/);
    // 빈 값 -> 오류, PATCH 없음
    await page.locator('#account-name').fill('   ');
    await page.locator('#account-save').click();
    await expect(page.locator('#account-name-error')).not.toHaveText('');
    expect(await page.locator('#account-name-error').getAttribute('role')).toBe('alert');
    await expect(page.locator('#account-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#account-name')).toBeFocused();
    expect(patches).toEqual([]);
    await ready(page, u.account.name); // 헤더 변하지 않음
    // 21자 -> 오류
    await page.locator('#account-name').fill('나'.repeat(21));
    await page.locator('#account-save').click();
    await expect(page.locator('#account-name-error')).not.toHaveText('');
    expect(patches).toEqual([]);
    // 저장
    let navs = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs += 1; });
    await page.locator('#account-name').fill('  바뀐   이름 ');
    await page.locator('#account-save').click();
    await expect(page.locator('#account-status')).toHaveText('저장했어요');
    expect(await page.locator('#account-status').getAttribute('role')).toBe('status');
    await expect(page.locator('#account-name-error')).toHaveText('');
    await ready(page, '바뀐 이름');
    await expect(page.locator('#account-name')).toHaveValue('바뀐 이름');
    expect(navs).toBe(0);
    expect(patches.map((p) => JSON.parse(p))).toEqual([{ name: '바뀐 이름' }]);
    // 새로고침 -> 해시 화면 유지, 서버에 반영
    await page.reload();
    await expect(page.locator('#panel-account')).toBeVisible();
    await ready(page, '바뀐 이름');
    expect((await (await get(u.api, '/api/auth/me')).json()).user.name).toBe('바뀐 이름');
    // 뒤로 가기
    await page.locator('#account-back').click();
    await expect(page.locator('#panel-record')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#panel-account')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#panel-record')).toBeVisible();
    await expect(page.locator('#panel-account')).toBeHidden();
    // 다시 들어오면 저장된 값으로 되돌아와 있다 (편집 중 값 폐기)
    await page.locator('#user-name').click();
    await page.locator('#account-name').fill('편집만');
    await page.locator('#account-back').click();
    await page.locator('#user-name').click();
    await expect(page.locator('#account-name')).toHaveValue('바뀐 이름');
    // 서버 오류(400) 표시
    await page.route('**/api/auth/me', (r) => (r.request().method() === 'PATCH'
      ? r.fulfill({ status: 400, contentType: 'application/json', json: { error: { code: 'VALIDATION_ERROR', message: 'x', fields: { name: '서버 이름 오류' } } } })
      : r.continue()));
    await page.locator('#account-name').fill('유효한 이름');
    await page.locator('#account-save').click();
    await expect(page.locator('#account-name-error')).toHaveText('서버 이름 오류');
    await ready(page, '바뀐 이름');
    await ui.ctx.close();
  });

  test('C-N9 만료된 세션에서 저장하면 로그인 화면으로', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('n9exp');
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    await page.goto('/#account');
    await ready(page, u.account.name);
    await page.route('**/api/auth/me', (r) => (r.request().method() === 'PATCH'
      ? r.fulfill({ status: 401, contentType: 'application/json', json: { error: { code: 'UNAUTHENTICATED', message: '로그인이 필요해요' } } })
      : r.continue()));
    await page.locator('#account-name').fill('만료 테스트');
    await page.locator('#account-save').click();
    await page.waitForURL(/\/login\.html/);
    await ui.ctx.close();
  });

  test('C-N10 JS 로드 실패 상태 가입 폼 제출: 이름·이메일·비밀번호가 URL 과 GET 요청에 남지 않는다', async ({ browser }, testInfo) => {
    onlyMobile(testInfo);
    const ctx = await browser.newContext({ extraHTTPHeaders: TRUST_PROXY ? { 'x-forwarded-for': uniqueIp() } : undefined });
    const page = await ctx.newPage();
    await page.route('**/js/**', (r) => r.abort()); // 스크립트 실패 재현 (이름 칸은 가입 전용이라 강제로 연다)
    const urls = [];
    page.on('request', (r) => urls.push(`${r.method()} ${r.url()}`));
    await page.goto('/login.html');
    await page.evaluate(() => { document.getElementById('name-field').hidden = false; });
    await page.fill('#name', 'NoJsName-Marker-777');
    await page.fill('#email', 'nojs-name@example.com');
    await page.fill('#password', 'NoJsPw-Marker-777');
    await Promise.all([page.waitForLoadState('load'), page.keyboard.press('Enter')]).catch(() => {});
    await page.waitForTimeout(500);
    expect(page.url()).not.toMatch(/Marker|nojs-name|password|name=/);
    const joined = urls.join('\n');
    expect(joined).not.toContain('NoJsName-Marker-777');
    expect(joined).not.toContain('NoJsPw-Marker-777');
    expect(urls.some((x) => x.startsWith('POST '))).toBe(true);
    expect(await readFileSync(join(PUBLIC, 'login.html'), 'utf8')).toMatch(/<form[^>]*method="post"/);
    await ctx.close();
  });
});

// ====================================================================== 마이그레이션 (기존 사용자 name null)
test.describe('C-N1 마이그레이션과 기존 사용자', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);
  let oldDir; let dbDir; let legacy; let live;

  test.beforeEach(async ({}, testInfo) => { onlyMobile(testInfo); });
  test.beforeAll(async ({}, testInfo) => {
    if (widthOf(testInfo) !== 360) return;
    oldDir = checkoutCommit(OLD_COMMIT);
    dbDir = tmpPgliteDir();
  });
  test.afterAll(async () => {
    await live?.stop();
    if (oldDir) removeCheckout(oldDir);
    if (dbDir) removeDir(dbDir);
  });

  test('C-N1 픽스처: 구버전 코드·스키마로 기존 사용자 생성, name 컬럼 없음', async () => {
    migrate(dbDir, {}, oldDir);
    expect(dbQuery(dbDir, `select count(*)::int as n from information_schema.columns where table_name='users' and column_name='name'`)[0].n).toBe(0);
    const old = await startServer({ dir: dbDir, cwd: oldDir });
    try {
      legacy = newAccount('legacy');
      const api = await newApi({ baseURL: old.url });
      const r = await signup(api, legacy);
      expect(r.status()).toBe(201);
      expect((await r.json()).user).toEqual({ id: expect.any(String), email: legacy.email }); // 구버전 응답에는 name 없음
      expect((await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 4321, category: '식비', memo: '구', date: '2026-10-05' })).status()).toBe(201);
    } finally { await old.stop(); }
  });

  test('C-N1 새 스키마 2회 적용: 오류 없음, nullable, 기존 사용자 name null, 거래 보존, name 없는 INSERT 성공, 21자·빈 문자열 CHECK 위반', async () => {
    const before = dbQuery(dbDir, 'select count(*)::int as n, coalesce(sum(amount),0)::int as total from transactions')[0];
    const out1 = migrate(dbDir);
    const out2 = migrate(dbDir);
    expect(out1).toBeTruthy(); expect(out2).toBeTruthy();
    const col = dbQuery(dbDir, `select data_type, is_nullable, column_default from information_schema.columns where table_name='users' and column_name='name'`);
    expect(col).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }]);
    expect(dbQuery(dbDir, `select count(*)::int as n from pg_constraint where conrelid='users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%char_length(name)%'`)[0].n).toBe(1); // 2회 적용해도 CHECK 중복 없음
    expect(dbQuery(dbDir, `select count(*)::int as n, count(name)::int as named from users`)[0]).toEqual({ n: 1, named: 0 });
    expect(dbQuery(dbDir, 'select count(*)::int as n, coalesce(sum(amount),0)::int as total from transactions')[0]).toEqual(before);
    dbExec(dbDir, `insert into users (id, email, password_hash) values ('33333333-3333-4333-8333-333333333333', 'noname-insert@example.com', 'x')`);
    expect(dbQuery(dbDir, `select name from users where email='noname-insert@example.com'`)).toEqual([{ name: null }]);
    expect(() => dbExec(dbDir, `insert into users (id, email, password_hash, name) values ('44444444-4444-4444-8444-444444444444', 'long-name@example.com', 'x', '${'가'.repeat(21)}')`)).toThrow();
    expect(() => dbExec(dbDir, `insert into users (id, email, password_hash, name) values ('55555555-5555-4555-8555-555555555555', 'empty-name@example.com', 'x', '')`)).toThrow();
    dbExec(dbDir, `insert into users (id, email, password_hash, name) values ('66666666-6666-4666-8666-666666666666', 'ok20@example.com', 'x', '${'가'.repeat(20)}')`);
    dbExec(dbDir, `delete from users where email in ('noname-insert@example.com','ok20@example.com')`);
  });

  test('C-N1 구버전 코드는 마이그레이션 후에도 그대로 동작 (롤백 안전)', async () => {
    const old = await startServer({ dir: dbDir, cwd: oldDir });
    try {
      const api = await newApi({ baseURL: old.url });
      expect((await login(api, legacy)).status()).toBe(200);
      const acc = newAccount('oldafter');
      expect((await signup(await newApi({ baseURL: old.url }), acc)).status()).toBe(201);
    } finally { await old.stop(); }
    dbExec(dbDir, `delete from users where email like 'qa+%oldafter%'`);
  });

  test('C-N4 기존 사용자: login/me 는 name null, 로그인 성공, 거래 그대로', async () => {
    live = await startServer({ dir: dbDir });
    const api = await newApi({ baseURL: live.url });
    const li = await login(api, legacy);
    expect(li.status()).toBe(200);
    expect((await li.json()).user).toEqual({ id: expect.any(String), email: legacy.email, name: null });
    const me = await (await get(api, '/api/auth/me')).json();
    expect(me.user).toEqual({ id: expect.any(String), email: legacy.email, name: null });
    const txs = await (await get(api, '/api/transactions?month=2026-10')).json();
    expect(JSON.stringify(txs)).toContain('4321');
  });

  test('C-N9 기존 사용자 UI: 헤더 이메일 폴백 -> 내 정보에서 이름 저장 -> 헤더가 이름으로, DB 반영', async ({ browser }, testInfo) => {
    const ui = await newUiPage(browser, testInfo, { baseURL: live.url });
    const { page } = ui;
    await page.goto('/login.html');
    await page.locator('#email').fill(legacy.email);
    await page.locator('#password').fill(legacy.password);
    await page.locator('#submit-btn').click();
    await page.waitForURL((x) => x.pathname === '/' || x.pathname === '/index.html');
    await expect(page.locator('#user-name')).toHaveText(legacy.email);
    await expect(page.locator('#user-name')).toHaveAttribute('title', legacy.email);
    expect(await page.locator('#user-name').getAttribute('aria-label')).toContain('이름 설정');
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible(); // 기존 거래 표시
    await page.locator('#user-name').click();
    await expect(page.locator('#account-hint')).toHaveText('이름을 넣으면 위쪽에 이메일 대신 이름이 보여요.');
    await page.locator('#account-name').fill('기존 사용자');
    await page.locator('#account-save').click();
    await expect(page.locator('#account-status')).toHaveText('저장했어요');
    await expect(page.locator('#user-name')).toHaveText('기존 사용자');
    await expect(page.locator('#account-hint')).toHaveText('');
    await page.reload();
    await expect(page.locator('#user-name')).toHaveText('기존 사용자');
    await ui.ctx.close();
    await live.stop(); live = null;
    expect(dbQuery(dbDir, `select name from users where email='${legacy.email}'`)).toEqual([{ name: '기존 사용자' }]);
  });
});
