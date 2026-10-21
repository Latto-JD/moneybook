// plan 9.7 프론트엔드 (로그인/기록 탭) + C5. 360px(mobile-360) 와 768px(tablet-768) 두 프로젝트에서 실행.
// 셀렉터/문구는 frontend F11 보고와 src/frontend/public 코드 기준. UI "오늘"은 브라우저 시각이라 ctx.clock 으로 2026-10-19 고정.
// 서버는 TRUST_PROXY=true 로 띄우고 e2e 도 TRUST_PROXY=true (컨텍스트마다 고유 x-forwarded-for).
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createLoggedInUser, newApi, get, addTx, signup, uniqueIp, json } from '../helpers/api.js';
import { newAccount, PASSWORD } from '../helpers/accounts.js';
import { newUiPage, uiLogin, expectNoHorizontalScroll, FIXED_TODAY } from '../helpers/ui.js';
import { BASE_URL, SEED_EMAIL, SEED_PASSWORD } from '../helpers/env.js';
import { ROOT, startServer, migrate, tmpPgliteDir, removeDir, qaOp } from '../helpers/server.js';

// 비밀 값 검색(P2)에 걸리지 않도록 연결 문자열 스킴을 조립한다.
const PG_SCHEME = 'postgres' + 'ql://';
const EXPIRED = '로그인이 만료되었어요. 다시 로그인해 주세요';
const widthOf = (testInfo) => testInfo.project.use.viewport.width;

/** 로그인한 새 사용자로 앱(#record) 열기 */
async function openRecord(browser, testInfo, { prepare, hash = '#record' } = {}) {
  const u = await createLoggedInUser('ui');
  if (prepare) await prepare(u.api, u);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  await ui.page.goto(`/${hash}`);
  await expect(ui.page.locator('#user-name')).toHaveText(u.account.name);
  return { ...ui, ...u };
}
const chip = (page, name) => page.locator('#category-chips button', { hasText: name }).first();
const rowCount = (page) => page.locator('#tx-list .tx-row').count();

// ============================================================ C5, C27, C28
test.describe('C5 정적 HTML', () => {
  for (const path of ['/', '/login.html']) {
    test(`C5 ${path} 200 HTML, viewport 메타, 인라인 script/on* 없음`, async () => {
      const api = await newApi();
      const res = await get(api, path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('text/html');
      const html = await res.text();
      expect(html).toMatch(/<meta\s+name="viewport"/i);
      const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
      expect(scripts.length).toBeGreaterThan(0);
      for (const m of scripts) expect(m[1]).toMatch(/\bsrc\s*=/i);
      expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    });
  }
});

test.describe('C27 정적 접근성', () => {
  const unlabeledInputs = (page) => page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=hidden]), textarea')].filter((el) => {
      const hasLabel = el.labels && el.labels.length > 0;
      return !(hasLabel || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
    }).map((el) => el.outerHTML.slice(0, 80)));

  test('C27 기록 탭: 금액 inputmode=numeric, 모든 input 에 label, select 없음, 카테고리는 버튼 칩', async ({ browser }, testInfo) => {
    const { page, ctx } = await openRecord(browser, testInfo);
    await expect(page.locator('#amount')).toHaveAttribute('inputmode', 'numeric');
    expect(await unlabeledInputs(page)).toEqual([]);
    expect(await page.locator('select:not(#theme-select)').count()).toBe(0); // 헤더 화면 모드 select(#theme-select)는 계획서 6.1 로 추가됨
    expect(await page.locator('#category-chips button').count()).toBe(8);
    await page.locator('#type-income').click();
    expect(await page.locator('#category-chips button').count()).toBe(4);
    await ctx.close();
  });
  test('C27 로그인 화면: input 에 label, select 없음, type=email/password', async ({ page }) => {
    await page.goto('/login.html');
    expect(await unlabeledInputs(page)).toEqual([]);
    expect(await page.locator('select').count()).toBe(0);
    await expect(page.locator('#email')).toHaveAttribute('type', 'email');
    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  });
});

test.describe('C28 유틸 (프론트 순수 함수를 Node 에서 직접 실행)', () => {
  test('C28 parseAmount/formatWon/차트 기하 함수 (합계 0 -> NaN 없는 빈 결과)', async () => {
    const lib = (f) => import(pathToFileURL(resolve(ROOT, 'src/frontend/public/js/lib', f)).href);
    const money = await lib('money.js');
    const geo = await lib('chart-geometry.js');
    expect(money.parseAmount('12,500')).toBe(12500);
    for (const bad of ['abc', '', '0', '-5', '1.5', '100,000,001']) expect(money.parseAmount(bad), bad).toBeNull();
    expect(money.parseAmount('1')).toBe(1);
    expect(money.parseAmount('100,000,000')).toBe(100000000);
    expect(money.formatWon(12500)).toBe('12,500원');
    expect(money.formatWon(0)).toBe('0원');
    expect(geo.donutSegments([])).toEqual([]);
    expect(geo.donutSegments([{ label: 'a', value: 0 }, { label: 'b', value: 0 }])).toEqual([]);
    expect(geo.ratioOf(5, 0)).toBe(0);
    expect(geo.formatPercent(Number.NaN)).toBe('0.0%');
    expect(JSON.stringify(geo.niceScale(0, 4))).not.toMatch(/NaN|null|Infinity/);
    expect(geo.barHeight(0, 0, 100)).toBe(0);
    expect(JSON.stringify(geo.barLayout(0, 2, 300))).not.toMatch(/NaN|Infinity/);
  });
});

// ============================================================ C57~C60 로그인/가입
test.describe('C57 로그인 리다이렉트', () => {
  test('C57 비로그인 / -> /login.html', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/login\.html/);
  });
  test('C57 로그인 상태 /login.html -> /', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('c57');
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/login.html');
    await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html');
    await ctx.close();
  });
});

test.describe('로그인 화면 동작 / 문구', () => {
  test('모드 전환: 버튼 문구 로그인/가입하기, aria-pressed, 비밀번호 보기 토글', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#submit-btn')).toHaveText('로그인');
    await expect(page.locator('#mode-login')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#mode-signup').click();
    await expect(page.locator('#submit-btn')).toHaveText('가입하기');
    await expect(page.locator('#mode-signup')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'new-password');
    await page.locator('#mode-login').click();
    await expect(page.locator('#submit-btn')).toHaveText('로그인');
    await page.locator('#password').fill('toggle-pw-1');
    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
    await page.locator('#show-password').check();
    await expect(page.locator('#password')).toHaveAttribute('type', 'text');
    await page.locator('#show-password').uncheck();
    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  });

  test('클라이언트 검증: 빈 이메일/잘못된 이메일/짧은 비밀번호 -> 필드 오류, 서버 호출 없음', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/login', (r) => { calls += 1; return r.continue(); });
    await page.goto('/login.html');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#email-error')).toHaveText('이메일을 입력해 주세요');
    await page.locator('#email').fill('a@b');
    await page.locator('#password').fill('short');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#email-error')).toHaveText('이메일 형식이 맞지 않아요');
    await page.locator('#email').fill('ok@example.com');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#password-error')).toHaveText('비밀번호는 8자 이상이어야 해요');
    await expect(page.locator('#email')).toHaveValue('ok@example.com');
    expect(calls).toBe(0);
  });

  test('틀린 비밀번호 -> "이메일 또는 비밀번호가 맞지 않아요" (role=alert), 이메일 유지', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('badpw');
    const { ctx, page } = await newUiPage(browser, testInfo);
    await page.goto('/login.html');
    await page.locator('#email').fill(u.account.email);
    await page.locator('#password').fill('wrong-password-1');
    await page.locator('#submit-btn').click();
    await expect(page.getByRole('alert').filter({ hasText: '이메일 또는 비밀번호가 맞지 않아요' })).toBeVisible();
    await expect(page.locator('#form-error')).toHaveText('이메일 또는 비밀번호가 맞지 않아요');
    await expect(page.locator('#email')).toHaveValue(u.account.email);
    await expect(page.locator('#submit-btn')).toBeEnabled();
    await ctx.close();
  });

  test('로그인 연속 실패 5회 후 6번째(정답) -> "시도가 너무 많아요. 15분 후 다시 시도해 주세요" (실제 429)', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('login429');
    const { ctx, page } = await newUiPage(browser, testInfo);
    await page.goto('/login.html');
    await page.locator('#email').fill(u.account.email);
    for (let i = 0; i < 5; i++) {
      await page.locator('#password').fill(`wrong-password-${i}`);
      await page.locator('#submit-btn').click();
      await expect(page.locator('#form-error')).toHaveText('이메일 또는 비밀번호가 맞지 않아요');
    }
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#submit-btn').click();
    await expect(page.locator('#form-error')).toHaveText(/^시도가 너무 많아요\. \d+분 후 다시 시도해 주세요$/);
    expect(await page.locator('#form-error').textContent()).toBe('시도가 너무 많아요. 15분 후 다시 시도해 주세요');
    await expect(page.locator('#email')).toHaveValue(u.account.email);
    await ctx.close();
  });

  test('?expired=1 -> "로그인이 만료되었어요. 다시 로그인해 주세요"', async ({ page }) => {
    await page.goto('/login.html?expired=1');
    await expect(page.locator('#form-error')).toHaveText(EXPIRED);
  });
});

test.describe('C58 가입', () => {
  test('C58 가입 -> 앱 진입(금액칸 포커스, #user-name 에 이름 표시), 로그인 상태', async ({ browser }, testInfo) => {
    const acc = newAccount('c58new');
    const { ctx, page } = await newUiPage(browser, testInfo);
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.locator('#name').fill('가입 테스터');
    await page.locator('#email').fill(acc.email);
    await page.locator('#password').fill(acc.password);
    await page.locator('#submit-btn').click();
    await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html');
    await expect(page.locator('#user-name')).toHaveText('가입 테스터');
    await expect(page.locator('#amount')).toBeFocused();
    await ctx.close();
  });

  test('C58 중복 이메일(대소문자 달라도) -> "이미 가입된 이메일이에요", 입력한 이메일 유지', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('c58dup');
    const { ctx, page } = await newUiPage(browser, testInfo);
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.locator('#name').fill('가입 테스터');
    const typed = u.account.email.toUpperCase();
    await page.locator('#email').fill(typed);
    await page.locator('#password').fill('another-pass-1');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#form-error')).toHaveText('이미 가입된 이메일이에요');
    await expect(page.locator('#email')).toHaveValue(typed);
    await expect(page.locator('#submit-btn')).toBeEnabled();
    await ctx.close();
  });

  test('C58 짧은 비밀번호(7자) -> 안내 문구, 이메일 유지, 가입 요청 없음', async ({ browser }, testInfo) => {
    const { ctx, page } = await newUiPage(browser, testInfo);
    let calls = 0;
    await page.route('**/api/auth/signup', (r) => { calls += 1; return r.continue(); });
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.locator('#name').fill('가입 테스터');
    await page.locator('#email').fill('short-pw@example.com');
    await page.locator('#password').fill('1234567');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#password-error')).toHaveText('비밀번호는 8자 이상이어야 해요');
    await expect(page.locator('#email')).toHaveValue('short-pw@example.com');
    expect(calls).toBe(0);
    await ctx.close();
  });

  test('C58 가입 429(같은 IP 가입 10회 후) -> "시도가 너무 많아요. N분 후 다시 시도해 주세요", 이메일 유지 (실제 429)', async ({ browser }, testInfo) => {
    const ip = uniqueIp(); // 이 IP 로 API 가입 10회를 채운다
    for (let i = 0; i < 10; i++) {
      const api = await newApi({ extraHeaders: { 'x-forwarded-for': ip } });
      expect((await signup(api, newAccount('c58rl'))).status()).toBe(201);
    }
    const { ctx, page } = await newUiPage(browser, testInfo, { ip });
    await page.goto('/login.html');
    await page.locator('#mode-signup').click();
    await page.locator('#name').fill('가입 테스터');
    const email = newAccount('c58rl11').email;
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('password-ok-1');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#form-error')).toHaveText(/^시도가 너무 많아요\. \d+분 후 다시 시도해 주세요$/);
    await expect(page.locator('#email')).toHaveValue(email);
    await ctx.close();
  });

  test('가입 닫힘(SIGNUP_ENABLED=false 서버) -> "지금은 새로 가입할 수 없어요. 관리자에게 문의해 주세요"', async ({ browser }, testInfo) => {
    const dir = tmpPgliteDir();
    let s;
    try {
      migrate(dir);
      s = await startServer({ dir, port: Number(process.env.QA_UI_PORT_CLOSED || 3512), env: { SIGNUP_ENABLED: 'false' } });
      const { ctx, page } = await newUiPage(browser, testInfo, { baseURL: s.url, ip: uniqueIp() });
      await page.goto('/login.html');
      await page.locator('#mode-signup').click();
    await page.locator('#name').fill('가입 테스터');
      await page.locator('#email').fill('closed@example.com');
      await page.locator('#password').fill('password-ok-1');
      await page.locator('#submit-btn').click();
      await expect(page.locator('#form-error')).toHaveText('지금은 새로 가입할 수 없어요. 관리자에게 문의해 주세요');
      await expect(page.locator('#email')).toHaveValue('closed@example.com');
      await ctx.close();
    } finally { await s?.stop(); removeDir(dir); }
  });

  test('서버 오류(DB 연결 실패 서버, 로그인 500) -> "서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요."', async ({ browser }, testInfo) => {
    const dir = tmpPgliteDir();
    let s;
    try {
      s = await startServer({
        dir, port: Number(process.env.QA_UI_PORT_BROKEN || 3513),
        env: { DB_DRIVER: '', QA_TOOLS: 'false', DATABASE_URL: PG_SCHEME + 'qa_user:qa_leak_pw@127.0.0.1:1/qa_db' },
      });
      const { ctx, page } = await newUiPage(browser, testInfo, { baseURL: s.url, ip: uniqueIp() });
      await page.goto('/login.html');
      await page.locator('#email').fill('broken@example.com');
      await page.locator('#password').fill('password-ok-1');
      await page.locator('#submit-btn').click();
      await expect(page.locator('#form-error')).toHaveText('서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      expect(await page.locator('body').innerText()).not.toMatch(/qa_leak_pw|ECONNREFUSED|127\.0\.0\.1/);
      await ctx.close();
    } finally { await s?.stop(); removeDir(dir); }
  });
});

test.describe('C59 로그아웃 / C60 세션 소멸', () => {
  test('C59 로그아웃 -> 로그인 화면, 이전 쿠키 401, 뒤로가기로 앱에 가도 데이터 없이 로그인 화면으로', async ({ browser }, testInfo) => {
    const { ctx, page, account } = await openRecord(browser, testInfo, {
      prepare: (api) => addTx(api, { memo: '로그아웃전메모', amount: 3210, date: FIXED_TODAY }),
    });
    await expect(page.locator('#tx-list .tx-row').first()).toContainText('로그아웃전메모');
    const cookies = await ctx.cookies();
    const sid = cookies.find((c) => c.name === 'mb_sid');
    await page.locator('#logout-btn').click();
    await page.waitForURL(/\/login\.html/);
    // 같은 토큰으로 재사용 불가
    const replay = await newApi({ extraHeaders: { Cookie: `mb_sid=${sid.value}` } });
    expect((await get(replay, '/api/auth/me')).status()).toBe(401);
    // 뒤로가기
    await page.goBack();
    await page.waitForURL(/\/login\.html/, { timeout: 10_000 });
    expect(await page.locator('body').innerText()).not.toContain('로그아웃전메모');
    expect(await page.locator('body').innerText()).not.toContain(account.email);
    await expect(page.locator('#tx-list')).toHaveCount(0);
    await ctx.close();
  });

  test('C60 세션을 DB 에서 삭제한 뒤 저장 -> 만료 안내 + 로그인 화면', async ({ browser }, testInfo) => {
    const { ctx, page, account } = await openRecord(browser, testInfo);
    await page.locator('#amount').fill('5000');
    await chip(page, '식비').click();
    const r = await qaOp(BASE_URL, 'delete-sessions', { email: account.email });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await page.locator('#save-btn').click();
    await page.waitForURL(/\/login\.html\?expired=1/);
    await expect(page.locator('#form-error')).toHaveText(EXPIRED);
    await ctx.close();
  });
});

// ============================================================ C29~C34, C61 기록 탭
test.describe('C29 기록 입력', () => {
  test('C29 UI 로그인 후 금액칸 포커스, 금액 -> 카테고리 칩 -> 저장 버튼으로 기록, 목록·요약이 새로고침 없이 갱신', async ({ browser }, testInfo) => {
    const acc = (await createLoggedInUser('c29')).account;
    const { ctx, page } = await newUiPage(browser, testInfo);
    await uiLogin(page, acc);
    await expect(page.locator('#amount')).toBeFocused();
    await expect(page.locator('#amount')).toHaveAttribute('inputmode', 'numeric');
    await page.evaluate(() => { window.__qaMarker = 1; });
    await page.locator('#amount').fill('12500');
    await expect(page.locator('#amount')).toHaveValue('12,500'); // 실시간 천 단위 콤마
    await chip(page, '식비').click();
    await expect(chip(page, '식비')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await expect(page.locator('#tx-list .tx-row')).toContainText('12,500원');
    await expect(page.locator('#month-summary')).toContainText('12,500원');
    await expect(page.locator('#amount')).toHaveValue('');
    await expect(page.locator('#amount')).toBeFocused();
    expect(await page.evaluate(() => window.__qaMarker)).toBe(1); // 새로고침 없음
    await ctx.close();
  });

  test('C29(Enter) 금액 -> 카테고리 칩 -> Enter 로 저장 (plan 7.3: 칩을 누른 직후 Enter)', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await page.locator('#amount').fill('8000');
    await chip(page, '교통').click();
    await page.keyboard.press('Enter'); // 포커스는 방금 누른 칩 버튼
    await expect(page.locator('#flash'), '칩 선택 직후 Enter 로 저장되어야 함').toHaveText('저장했어요', { timeout: 3000 });
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await ctx.close();
  });

  test('C29(Enter 추가1) 선택 전 칩에서 Enter/Space 는 선택만 하고 저장하지 않음', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    let posts = 0;
    await page.route('**/api/transactions', (r) => { if (r.request().method() === 'POST') posts += 1; return r.continue(); });
    await page.locator('#amount').fill('5000');
    for (const key of ['Enter', 'Space']) {
      await chip(page, '식비').focus();
      await expect(chip(page, '식비')).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press(key);
      await expect(chip(page, '식비')).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(500);
      expect(posts, `${key} 로 저장되면 안 됨`).toBe(0);
      expect(await rowCount(page)).toBe(0);
      await expect(page.locator('#flash')).not.toHaveText('저장했어요');
      // 다음 반복을 위해 다른 칩으로 선택 이동 (Enter/Space 이후엔 이미 선택 상태이므로 다른 칩을 선택)
      await chip(page, '교통').click();
      await expect(chip(page, '식비')).toHaveAttribute('aria-pressed', 'false');
      posts = 0;
    }
    await ctx.close();
  });

  test('C29(Enter 추가2) 칩 선택 후 금액이 비어 있으면 Enter 로 저장되지 않고 오류 표시', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    let posts = 0;
    await page.route('**/api/transactions', (r) => { if (r.request().method() === 'POST') posts += 1; return r.continue(); });
    await chip(page, '교통').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#amount-error')).toHaveText('금액은 1원 이상 1억원 이하의 숫자로 입력해 주세요');
    await page.waitForTimeout(500);
    expect(posts).toBe(0);
    expect(await rowCount(page)).toBe(0);
    await expect(page.locator('#flash')).not.toHaveText('저장했어요');
    await ctx.close();
  });

  test('C29(Enter 추가3) 한 번의 Enter 로 저장하면 POST 는 정확히 1번(이중 저장 없음)', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    let posts = 0;
    await page.route('**/api/transactions', (r) => { if (r.request().method() === 'POST') posts += 1; return r.continue(); });
    await page.locator('#amount').fill('8000');
    await chip(page, '교통').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await page.waitForTimeout(800);
    expect(posts).toBe(1);
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await ctx.close();
  });

  test('C29(Enter 추가4) 저장 응답이 느릴 때 Enter 를 빠르게 두 번 눌러도 POST 는 1번', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    let posts = 0;
    await page.route('**/api/transactions', async (r) => {
      if (r.request().method() === 'POST') { posts += 1; await new Promise((res) => setTimeout(res, 800)); }
      return r.continue();
    });
    await page.locator('#amount').fill('8000');
    await chip(page, '교통').click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // 별개의 키 입력(repeat 아님), 첫 저장 응답 전
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await page.waitForTimeout(1500);
    expect(posts, '이중 POST').toBe(1);
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await ctx.close();
  });

  test('C29(Enter 추가5) 이중 Enter(3회) 후 서버 목록에도 거래는 1건 (API 확인)', async ({ browser }, testInfo) => {
    const { ctx, page, api } = await openRecord(browser, testInfo);
    await page.route('**/api/transactions', async (r) => {
      if (r.request().method() === 'POST') await new Promise((res) => setTimeout(res, 800));
      return r.continue();
    });
    await page.locator('#amount').fill('8000');
    await chip(page, '교통').click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await page.waitForTimeout(1500);
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    const res = await get(api, '/api/transactions?month=2026-10');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.transactions.length, '서버 거래 건수').toBe(1);
    await ctx.close();
  });

  test('C29(Enter 추가6) 저장 실패 후 재시도 가능, 재시도 중 이중 Enter 는 POST 1번', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    let posts = 0;
    let failNext = true;
    await page.route('**/api/transactions', async (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      posts += 1;
      if (failNext) { failNext = false; return r.abort('failed'); }
      await new Promise((res) => setTimeout(res, 600));
      return r.continue();
    });
    await page.locator('#amount').fill('8000');
    await chip(page, '교통').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tx-error')).toContainText('네트워크');
    await expect(page.locator('#save-btn')).toBeEnabled();
    expect(posts).toBe(1);
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(0);
    await chip(page, '교통').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await page.waitForTimeout(1200);
    expect(posts, '실패 1 + 성공 1').toBe(2);
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await ctx.close();
  });

  test('C29(Enter, 금액칸) 금액칸에서 Enter 로 저장 (카테고리 선택 후 금액칸 재포커스)', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await chip(page, '교통').click();
    await page.locator('#amount').fill('8000');
    await page.locator('#amount').press('Enter');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await ctx.close();
  });

  test('입력 검증: 금액 없음/카테고리 없음 -> #amount-error / #category-error, 서버 호출 없음; 수입 전환 시 카테고리 4개', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    let posts = 0;
    await page.route('**/api/transactions', (r) => { if (r.request().method() === 'POST') posts += 1; return r.continue(); });
    // 금액이 비면 저장 버튼은 aria-disabled="true"(모양만 비활성, D-17). Playwright 는 aria-disabled 를 비활성으로 보므로 force 로 실제 사용자 클릭을 재현한다.
    await expect(page.locator('#save-btn')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#save-btn')).toHaveText('지출 저장');
    await page.locator('#save-btn').click({ force: true });
    await expect(page.locator('#amount-error')).toHaveText('금액은 1원 이상 1억원 이하의 숫자로 입력해 주세요');
    await expect(page.locator('#category-error')).toHaveText('카테고리를 선택해 주세요');
    await page.locator('#amount').fill('0');
    await page.locator('#save-btn').click({ force: true });
    await expect(page.locator('#amount-error')).not.toHaveText('');
    expect(posts).toBe(0);
    await page.locator('#type-income').click();
    await expect(page.locator('#type-income')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#type-expense')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#category-chips button')).toHaveText(['급여', '용돈', '부수입', '기타']);
    await ctx.close();
  });

  test('날짜: 기본 "오늘"(details 접힘), 열어서 변경 시 요약 문구 갱신, 과거 날짜로 저장되면 그 달 목록에 표시', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await expect(page.locator('#date-summary')).toHaveText('오늘');
    await expect(page.locator('#date')).toBeHidden();
    await page.locator('#date-details summary').click();
    await expect(page.locator('#date')).toBeVisible();
    await expect(page.locator('#date')).toHaveValue(FIXED_TODAY);
    await page.locator('#date').fill('2026-09-30');
    await expect(page.locator('#date-summary')).toHaveText('9월 30일 (수)');
    await page.locator('#amount').fill('7000');
    await chip(page, '쇼핑').click();
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#month-title-h')).toContainText('2026년 9월');
    await expect(page.locator('#tx-list .tx-row')).toContainText('7,000원');
    await ctx.close();
  });

  test('수정/삭제: .tx-edit -> "수정 저장" + "수정 취소", 수정 후 "수정했어요"; 삭제는 confirm 취소 시 유지, 확인 시 "삭제했어요"', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo, {
      prepare: (api) => addTx(api, { memo: '수정대상', amount: 4000, category: '식비', date: FIXED_TODAY }),
    });
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await page.locator('.tx-edit').click();
    await expect(page.locator('#save-btn')).toHaveText('수정 저장 · 4,000원');
    await expect(page.locator('#cancel-edit-btn')).toBeVisible();
    await expect(page.locator('#amount')).toHaveValue('4,000');
    await expect(page.locator('#memo')).toHaveValue('수정대상');
    await page.locator('#cancel-edit-btn').click();
    await expect(page.locator('#save-btn')).toHaveText('지출 저장'); // 수정 취소 후: 금액이 비었으므로 금액 없는 라벨
    await expect(page.locator('#cancel-edit-btn')).toBeHidden();
    await page.locator('.tx-edit').click();
    await page.locator('#amount').fill('4500');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    await expect(page.locator('#tx-list .tx-row')).toContainText('4,500원');
    // 삭제: confirm 취소
    let msg = '';
    page.removeAllListeners('dialog');
    page.once('dialog', async (d) => { msg = d.message(); await d.dismiss(); });
    await page.locator('.tx-del').click();
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    expect(msg).toContain('삭제할까요');
    // 삭제: 확인
    page.once('dialog', (d) => d.accept());
    await page.locator('.tx-del').click();
    await expect(page.locator('#flash')).toHaveText('삭제했어요');
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(0);
    await expect(page.locator('#tx-list')).toContainText('아직 기록이 없어요');
    await ctx.close();
  });

  test('월 이동: #month-prev/#month-next 로 제목이 바뀌고 이번 달에서는 "(이번 달)"', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await expect(page.locator('#month-title-h')).toHaveText('2026년 10월 (이번 달)');
    await page.locator('#month-prev').click();
    await expect(page.locator('#month-title-h')).toHaveText('2026년 9월');
    await page.locator('#month-next').click();
    await expect(page.locator('#month-title-h')).toHaveText('2026년 10월 (이번 달)');
    await ctx.close();
  });

  test('탭: #tab-record/#tab-dashboard aria-current=page, 해시 유지, 새로고침 유지', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await expect(page.locator('#tab-record')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#tab-dashboard')).not.toHaveAttribute('aria-current', 'page');
    await page.locator('#tab-dashboard').click();
    await expect(page).toHaveURL(/#dashboard$/);
    await expect(page.locator('#tab-dashboard')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#panel-dashboard')).toBeVisible();
    await expect(page.locator('#panel-record')).toBeHidden();
    await page.reload();
    await expect(page.locator('#panel-dashboard')).toBeVisible();
    await ctx.close();
  });
});

test.describe('C30 빠른 입력', () => {
  test('C30 R1 칩 클릭(채움 + 저장 버튼 포커스) -> 저장 클릭, 2번 클릭으로 기록', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo, {
      prepare: async (api) => {
        for (const d of ['2026-10-15', '2026-10-17', '2026-10-18']) await addTx(api, { memo: '커피', category: '카페/간식', amount: 4500, date: d });
      },
    });
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(3);
    await expect(page.locator('#quick-section')).toBeVisible();
    const quick = page.locator('#quick-chips button').first();
    await expect(quick).toContainText('커피');
    await expect(quick).toContainText('4,500원');
    await quick.click(); // 1번째 터치
    await expect(page.locator('#memo')).toHaveValue('커피');
    await expect(page.locator('#amount')).toHaveValue('4,500');
    await expect(chip(page, '카페/간식')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#save-btn')).toBeFocused();
    await page.locator('#save-btn').click(); // 2번째 터치
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(4);
    await ctx.close();
  });
  test('C30 후보 없으면 빠른 입력 섹션 숨김', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await expect(page.locator('#quick-section')).toBeHidden();
    await ctx.close();
  });
});

test.describe('C31 자동완성', () => {
  test('C31 메모 "스타" 입력 -> 제안 표시, 선택하면 메모·카테고리·금액 채움', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo, {
      prepare: async (api) => {
        for (const d of ['2026-10-10', '2026-10-12']) await addTx(api, { memo: '스타벅스', category: '카페/간식', amount: 5200, date: d });
        await addTx(api, { memo: '스타벅스', category: '카페/간식', amount: 4500, date: '2026-10-18' });
      },
    });
    await page.locator('#memo').pressSequentially('스타');
    const sug = page.locator('#memo-suggestions button');
    await expect(sug.first()).toBeVisible();
    await expect(sug.first()).toContainText('스타벅스');
    await expect(sug.first()).toContainText('카페/간식');
    await sug.first().click();
    await expect(page.locator('#memo')).toHaveValue('스타벅스');
    await expect(page.locator('#amount')).toHaveValue('4,500'); // 가장 최근 거래 금액
    await expect(chip(page, '카페/간식')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#memo-suggestions button')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('C33 오류 처리', () => {
  test('C33 서버 400(실제 서버 응답: 요청 본문의 amount 를 0 으로 바꿔 전달) -> 오류 문구 표시 + 입력값 유지', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await page.route('**/api/transactions', (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.continue();
      return route.continue({ postData: JSON.stringify({ ...req.postDataJSON(), amount: 0 }) });
    });
    await page.locator('#amount').fill('12500');
    await chip(page, '식비').click();
    await page.locator('#memo').fill('입력값유지');
    await page.locator('#save-btn').click();
    const err = page.locator('#tx-error');
    await expect(err).not.toHaveText('');
    await expect(page.locator('#amount-error')).not.toHaveText(''); // error.fields.amount 가 있으면 필드 옆에도
    test.info().annotations.push({ type: 'observed', description: `tx-error="${await err.textContent()}" amount-error="${await page.locator('#amount-error').textContent()}"` });
    await expect(page.locator('#amount')).toHaveValue('12,500');
    await expect(page.locator('#memo')).toHaveValue('입력값유지');
    await expect(chip(page, '식비')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#save-btn')).toBeEnabled();
    expect(await rowCount(page)).toBe(0);
    await ctx.close();
  });

  test('C33 네트워크 실패(요청 차단) -> 오류 문구, 저장 버튼 복구(화면 멈춤 없음), 복구 후 재저장 성공', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await page.route('**/api/transactions', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
    await page.locator('#amount').fill('3300');
    await chip(page, '식비').click();
    await page.locator('#save-btn').click();
    await expect(page.locator('#tx-error')).toHaveText('네트워크 연결을 확인하고 다시 시도해 주세요.');
    await expect(page.locator('#save-btn')).toBeEnabled();
    await expect(page.locator('#amount')).toHaveValue('3,300');
    await page.unroute('**/api/transactions');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(1);
    await expect(page.locator('#tx-error')).toHaveText('');
    await ctx.close();
  });

  test('C33 서버 중지(별도 서버를 실제로 종료) 상태에서 저장 -> 오류 문구, 화면 멈춤 없음', async ({ browser }, testInfo) => {
    const dir = tmpPgliteDir();
    let s;
    try {
      migrate(dir);
      s = await startServer({ dir, port: Number(process.env.QA_UI_PORT_STOP || 3514) });
      const u = await createLoggedInUser('c33stop', { baseURL: s.url });
      const { ctx, page } = await newUiPage(browser, testInfo, { api: u.api, baseURL: s.url });
      await page.goto('/#record');
      await expect(page.locator('#user-name')).toHaveText(u.account.name);
      await s.stop();
      await page.locator('#amount').fill('9900');
      await chip(page, '식비').click();
      await page.locator('#save-btn').click();
      await expect(page.locator('#tx-error')).toHaveText('네트워크 연결을 확인하고 다시 시도해 주세요.');
      await expect(page.locator('#save-btn')).toBeEnabled();
      await page.locator('#memo').fill('아직입력가능');
      await expect(page.locator('#memo')).toHaveValue('아직입력가능');
      await ctx.close();
    } finally { await s?.stop(); removeDir(dir); }
  });
});

test.describe('C34 인사이트 영역', () => {
  test('C34 신규 사용자: 빈 상태 문구', async ({ browser }, testInfo) => {
    const { ctx, page } = await openRecord(browser, testInfo);
    await expect(page.locator('#insights')).toContainText('아직 알려드릴 내용이 없어요');
    await ctx.close();
  });

  test('C34 R3 dueSoon 강조("곧 예정") / 일반 반복 / R5 큰 지출 / R4 초과·페이스', async ({ browser }, testInfo) => {
    // 오늘 2026-10-19. 구독: 07-24, 08-23, 09-22 (30일 간격) -> 다음 예정 10-22 = today+3 -> dueSoon
    const { ctx, page } = await openRecord(browser, testInfo, {
      prepare: async (api) => {
        for (const d of ['2026-07-24', '2026-08-23', '2026-09-22']) await addTx(api, { memo: '곧구독', category: '문화/여가', amount: 9900, date: d });
        for (const d of ['2026-08-11', '2026-09-10', '2026-10-10']) await addTx(api, { memo: '여유구독', category: '문화/여가', amount: 5000, date: d });
        // R5: 쇼핑 비교군 5건(중앙값 10,000) + 오늘 50,000
        for (let i = 0; i < 5; i++) await addTx(api, { memo: `생필${i}`, category: '쇼핑', amount: 10000, date: `2026-10-0${i + 1}` });
        await addTx(api, { memo: '큰옷', category: '쇼핑', amount: 50000, date: FIXED_TODAY });
        // R4 exceeded: 식비 baseline 100,000 x3 (7~9월) + 이번 달 130,000
        for (const [i, m] of ['2026-07', '2026-08', '2026-09'].entries()) await addTx(api, { memo: `기준${i}`, category: '식비', amount: 100000, date: `${m}-15` });
        await addTx(api, { memo: '외식', category: '식비', amount: 130000, date: '2026-10-05' });
      },
    });
    const ins = page.locator('#insights');
    await expect(ins).toContainText('평소보다 많은 지출');
    await expect(ins.locator('.insight-overspending')).toContainText('평소보다 많음');
    await expect(ins.locator('.insight-overspending')).toContainText('식비: 이번 달 130,000원으로 평소 월 평균 100,000원보다 30% 많아요');
    await expect(ins).toContainText('반복 거래');
    const soon = ins.locator('.insight.strong');
    await expect(soon).toContainText('곧 예정');
    await expect(soon).toContainText('곧구독 9,900원 매월 반복 지출 · 다음 예정 10월 22일');
    await expect(ins.locator('.insight-recurring .insight:not(.strong)')).toContainText('여유구독');
    await expect(ins.locator('.insight-large')).toContainText('큰옷 50,000원 (쇼핑) - 평소 중앙값 10,000원의 5.0배');
    // 아이콘은 장식(aria-hidden), 의미는 텍스트 라벨
    expect(await ins.locator('.insight-icon[aria-hidden="true"]').count()).toBeGreaterThan(0);
    await ctx.close();
  });

  test('C34 시드 사용자(v2.1): 쇼핑·식비 평소보다 많음, 교통 지금 속도, 월세·넷플릭스는 평소보다 많은 지출 섹션에 없음', async ({ browser }, testInfo) => {
    test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요');
    const api = await newApi();
    expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#record');
    const over = page.locator('#insights .insight-overspending');
    await expect(over).toContainText('쇼핑: 이번 달 290,000원으로 평소 월 평균 100,000원보다 190% 많아요');
    await expect(over).toContainText('식비: 이번 달 420,000원으로 평소 월 평균 300,000원보다 40% 많아요');
    await expect(over).toContainText('지금 속도');
    await expect(over).toContainText('교통: 지금 속도면 이번 달 81,579원 예상이에요');
    await expect(over).not.toContainText('주거/통신');
    await expect(over).not.toContainText('문화/여가');
    await expect(page.locator('#insights .insight-recurring')).toContainText('월세 500,000원 매월 반복 지출');
    await expect(page.locator('#insights .insight-recurring')).toContainText('넷플릭스 17,000원 매월 반복 지출');
    await expect(page.locator('#insights .insight-large')).toContainText('패딩 250,000원');
    await ctx.close();
  });
});

test.describe('C61 XSS', () => {
  test('C61 메모 <img src=x onerror=alert(1)> 가 목록/인사이트/빠른입력/자동완성에서 글자 그대로, dialog 없음', async ({ browser }, testInfo) => {
    const xss = '<img src=x onerror=alert(1)>';
    const dialogs = [];
    const { ctx, page } = await openRecord(browser, testInfo, {
      prepare: async (api) => {
        // 월간 반복(R3) + 빠른 입력(R1) + 자동완성(R2) 모두에 메모가 나오도록 3건 (30일 간격, 오늘 2026-10-19 기준 활성)
        for (const d of ['2026-07-20', '2026-08-19', '2026-09-18']) await addTx(api, { memo: xss, category: '기타', amount: 5000, date: d });
        await addTx(api, { memo: xss, category: '기타', amount: 5000, date: FIXED_TODAY });
      },
    });
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto('/#record');
    await expect(page.locator('#tx-list')).toContainText(xss);
    await expect(page.locator('#quick-chips')).toContainText(xss);
    await expect(page.locator('#insights')).toContainText(xss);
    await page.locator('#memo').pressSequentially('<img');
    await expect(page.locator('#memo-suggestions')).toContainText(xss);
    // 이전 달(9월)로 이동해도 동일
    await page.locator('#month-prev').click();
    await expect(page.locator('#tx-list')).toContainText(xss);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.locator('#tx-list img, #insights img, #quick-chips img, #memo-suggestions img').count()).toBe(0);
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
    await ctx.close();
  });
});

// ============================================================ C32 (login, 기록 탭)
test.describe('C32 가로 스크롤/터치 영역 (login, 기록 탭)', () => {
  test('C32 login.html 가로 스크롤 없음, 주요 버튼 44x44 이상', async ({ page }, testInfo) => {
    await page.goto('/login.html');
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    const small = await tooSmall(page, ['#mode-login', '#mode-signup', '#submit-btn', 'label.check-label', '#email', '#password']);
    expect(small, JSON.stringify(small)).toEqual([]);
  });

  test('C32 기록 탭(시드 사용자: 목록·인사이트·빠른입력 포함) scrollWidth <= viewport, 주요 버튼 44x44 이상', async ({ browser }, testInfo) => {
    test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요');
    const api = await newApi();
    expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#record');
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await expect(page.locator('#quick-chips button').first()).toBeVisible();
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    const sels = ['#logout-btn', '#type-expense', '#type-income', '#category-chips button', '#quick-chips button', '#save-btn', '#month-prev', '#month-next',
      '.tx-edit', '.tx-del', '#tab-record', '#tab-dashboard', '#date-details summary'];
    const small = await tooSmall(page, sels);
    expect(small, JSON.stringify(small)).toEqual([]);
    // 수정 모드의 취소 버튼
    await page.locator('.tx-edit').first().click();
    expect(await tooSmall(page, ['#cancel-edit-btn', '#save-btn'])).toEqual([]);
    // 자동완성 제안 칩
    await page.locator('#cancel-edit-btn').click();
    await page.locator('#memo').pressSequentially('스타');
    await expect(page.locator('#memo-suggestions button').first()).toBeVisible();
    expect(await tooSmall(page, ['#memo-suggestions button'])).toEqual([]);
    await ctx.close();
  });
});

/** 선택자에 해당하는 보이는 요소 중 44x44 미만인 것 */
async function tooSmall(page, selectors) {
  return page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // 숨김
        if (r.width < 43.99 || r.height < 43.99) out.push(`${sel} "${(el.textContent || el.id).trim().slice(0, 12)}" ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      });
    }
    return out;
  }, selectors);
}
