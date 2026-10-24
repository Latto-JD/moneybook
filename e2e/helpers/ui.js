import { expect } from '@playwright/test';

/** 화면 텍스트에 NaN/undefined/Infinity 가 없는지 (4.6) */
export async function expectNoBadNumbers(page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\b(NaN|undefined|Infinity)\b/);
}

/** 가로 스크롤 없음 (C32) */
export async function expectNoHorizontalScroll(page, width) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(width);
}

// ---------------- UI(Playwright 브라우저) 공통 ----------------
import { BASE_URL, TRUST_PROXY } from './env.js';
import { uniqueIp } from './api.js';

/** UI "오늘"을 고정하는 시각 (브라우저 시각 기준; 시드 today 2026-10-19 와 맞춤) */
export const FIXED_NOW = '2026-10-19T12:00:00+09:00';
export const FIXED_TODAY = '2026-10-19';

/**
 * 브라우저 컨텍스트 + 페이지. api 를 주면 그 로그인 상태(쿠키)로 시작한다.
 * clock=true 면 Date 를 FIXED_NOW 로 고정(타이머는 실제로 흐름). 시간대는 Asia/Seoul.
 * TRUST_PROXY 서버를 쓸 때는 컨텍스트마다 고유 x-forwarded-for 를 보내 IP 가입/로그인 제한을 피한다.
 */
export async function newUiPage(browser, testInfo, { api, clock = true, baseURL = BASE_URL, ip, dialogs, reducedMotion = 'reduce' } = {}) {
  const ctx = await browser.newContext({
    baseURL,
    viewport: testInfo.project.use.viewport,
    hasTouch: testInfo.project.use.hasTouch,
    timezoneId: 'Asia/Seoul',
    locale: 'ko-KR',
    reducedMotion, // 기본은 움직임 줄이기(기존 e2e 가 애니메이션 없이 돈다). motion.spec.js 는 'no-preference' 를 넘긴다
    storageState: api ? await api.storageState() : undefined,
    extraHTTPHeaders: TRUST_PROXY ? { 'x-forwarded-for': ip || uniqueIp() } : undefined,
  });
  if (clock) await ctx.clock.setFixedTime(new Date(FIXED_NOW));
  const page = await ctx.newPage();
  const seen = dialogs || [];
  page.on('dialog', async (d) => { seen.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
  page.on('pageerror', (e) => { (page.__errors ||= []).push(String(e)); });
  return { ctx, page, dialogs: seen };
}

/** 로그인 화면에서 UI 로 로그인 */
export async function uiLogin(page, { email, password }) {
  await page.goto('/login.html');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#submit-btn').click();
  await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html');
}

/** 숫자 문자열에서 정수 (예: "-1,234원" -> -1234) */
export const won = (text) => Number(String(text).replace(/[^\d-]/g, ''));
export const fmtWon = (n) => `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US')}원`;
