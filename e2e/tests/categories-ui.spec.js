// docs/plan-categories.md 13.4~13.5 (C-C23~C-C38) UI e2e. 360px(mobile-360) 와 768px(tablet-768) 두 프로젝트에서 실행.
// UI "오늘"은 ctx.clock 으로 2026-10-19 고정. 사용자마다 새 계정을 만든다. 서버는 TRUST_PROXY=true.
import { test, expect } from '@playwright/test';
import { createLoggedInUser, addTx, get, json, newApi } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll, expectNoBadNumbers, FIXED_TODAY } from '../helpers/ui.js';
import { SEED_EMAIL, SEED_PASSWORD } from '../helpers/env.js';

const widthOf = (testInfo) => testInfo.project.use.viewport.width;
// 디자인 적용 후 오류 색 = --color-error (라이트 #AC3A31 / 다크 #F59387). 옛 --danger(#b3261e)는 없어졌다.
const DANGER = 'rgb(172, 58, 49)';
const DANGER_DARK = 'rgb(245, 147, 135)';
const OK = 'rgb(11, 107, 58)';

const listCats = async (api) => (await get(api, '/api/categories')).json();
const mkCat = async (api, type, name) => {
  const r = await json(api, 'POST', '/api/categories', { type, name });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
};
const setActive = async (api, type, name, active) => {
  const it = (await listCats(api)).items.find((i) => i.type === type && i.name === name);
  const r = await json(api, 'PATCH', `/api/categories/${it.id}`, { active });
  expect(r.status(), await r.text()).toBe(200);
};

/** 로그인한 새 사용자로 앱 열기. 확인 대화상자는 ctl.accept 로 제어하고 메시지를 ctl.messages 에 쌓는다. CSP 위반 이벤트도 수집. */
async function openApp(browser, testInfo, { prepare, hash = '#record', accept = true } = {}) {
  const u = await createLoggedInUser('cui');
  if (prepare) await prepare(u.api, u);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  page.removeAllListeners('dialog');
  const ctl = { accept, messages: [], all: [] };
  page.on('dialog', async (d) => {
    ctl.all.push({ type: d.type(), message: d.message() });
    if (d.type() === 'confirm') ctl.messages.push(d.message());
    if (d.type() === 'confirm' && ctl.accept) await d.accept(); else await d.dismiss();
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) consoleErrors.push(m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toHaveText(u.account.name);
  return { ...ui, ...u, ctl, consoleErrors };
}
const cspViolations = (page) => page.evaluate(() => window.__csp || []);
const chipNames = (page) => page.locator('#category-chips button').allTextContents();
const waitChips = async (page, n) => { if (n !== undefined) await expect(page.locator('#category-chips button')).toHaveCount(n); else await expect(page.locator('#category-chips button').first()).toBeVisible(); };
const rowByName = (page, name) => page.locator('#panel-categories .cat-row', { has: page.locator('.cat-name', { hasText: new RegExp(`^${name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}$`) }) });
const activeNames = (page) => page.locator('#catm-active .cat-name').allTextContents();
const goManager = async (page) => { await page.locator('a.cat-edit-link').click(); await expect(page.locator('#panel-categories')).toBeVisible(); await expect(page.locator('#catm-active .cat-row').first()).toBeVisible(); };
// 도넛 조각의 (색, 무늬) 서명: fill="url(#패턴)" 이면 패턴 정의, 1번(단색)·묶음은 클래스(viz-fill-1 / viz-other)로 칠한다.
const sliceSignatures = (page) => page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => {
  const ref = p.getAttribute('fill');
  const m = ref && /^url\(#(.+)\)$/.exec(ref);
  if (m) return document.getElementById(m[1]).innerHTML.replace(/\s+/g, ' ');
  return `class:${p.getAttribute('class')}`;
}));
const goRecord = async (page) => { await page.locator('#catm-back').click(); await expect(page.locator('#panel-record')).toBeVisible(); };

// 브라우저 안에서 임의 요소 집합 색 전수 검사: 오류 문구(.error-text/.field__error)·삭제 버튼(.btn-danger/.btn--danger)·
// 오류 상태 입력(aria-invalid 와 그 금액 밑줄 래퍼) 제외. 라이트·다크 오류 색과 옛 초록(OK)이 다른 곳에 있으면 실패.
const scanColors = (page) => page.evaluate(({ DANGER, DANGER_DARK, OK }) => {
  const bad = [];
  const BAD = new Set([DANGER, DANGER_DARK, OK]);
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('.error-text, .field__error, .btn-danger, .btn--danger, [aria-invalid="true"]')) continue;
    if (e.matches('.amount-wrap') && e.querySelector('[aria-invalid="true"]')) continue;
    const cs = getComputedStyle(e);
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'fill', 'stroke', 'outlineColor']) {
      const v = cs[prop];
      if (BAD.has(v)) bad.push(`${e.tagName.toLowerCase()}.${e.className && e.className.baseVal === undefined ? e.className : ''} ${prop}=${v}`);
    }
    for (const a of ['fill', 'stroke']) {
      const v = e.getAttribute && e.getAttribute(a);
      if (v && /#b3261e|#0b6b3a|#ac3a31|#f59387/i.test(v)) bad.push(`${e.tagName} attr ${a}=${v}`);
    }
  }
  return bad;
}, { DANGER, DANGER_DARK, OK });

// ============================================================ C-C23 추가 -> 칩
test.describe('C-C23 관리 화면에서 추가·사용 안 함 -> 기록 칩 반영', () => {
  test('C-C23 "반려 동물" 추가 후 기록으로 돌아오면 새로고침 없이 칩 맨 끝, 금액->칩->Enter 저장, 사용 안 함으로 바꾸면 칩에서 사라짐', async ({ browser }, testInfo) => {
    const { page, ctx, ctl, api } = await openApp(browser, testInfo);
    await waitChips(page, 8);
    await page.evaluate(() => { window.__noReload = 'alive'; });
    await goManager(page);
    await expect(page.locator('#cat-title')).toBeFocused();
    await page.locator('#catm-name').fill('  반려   동물 ');
    await page.locator('#catm-name').press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'반려 동물' 카테고리를 추가했어요");
    await expect(page.locator('#catm-name')).toHaveValue('');
    await expect(page.locator('#catm-name')).toBeFocused(); // 연속 추가
    expect((await activeNames(page)).at(-1)).toBe('반려 동물');
    await goRecord(page);
    expect(await page.evaluate(() => window.__noReload)).toBe('alive');
    await waitChips(page, 9);
    expect((await chipNames(page)).at(-1)).toBe('반려 동물');
    await page.locator('#amount').fill('12000');
    await page.locator('#category-chips button', { hasText: '반려 동물' }).click();
    await page.locator('#category-chips button', { hasText: '반려 동물' }).press('Enter');
    await expect(page.locator('#tx-list')).toContainText('반려 동물');
    await expect(page.locator('#tx-list')).toContainText('12,000원');
    const tx = (await (await get(api, '/api/transactions?month=2026-10')).json()).transactions;
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ category: '반려 동물', amount: 12000, type: 'expense' });
    // 사용 안 함 -> 칩에서 사라짐
    await goManager(page);
    await rowByName(page, '반려 동물').getByRole('button', { name: '반려 동물 사용 안 함' }).click();
    await expect.poll(() => ctl.messages.length).toBe(1);
    expect(ctl.messages[0]).toContain("'반려 동물' 카테고리를 사용 안 함으로 바꿀까요?");
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    await goRecord(page);
    await waitChips(page, 8);
    expect(await chipNames(page)).not.toContain('반려 동물');
    // 과거 거래는 그대로 보임
    await expect(page.locator('#tx-list')).toContainText('반려 동물');
    await ctx.close();
  });
});

test.describe('관리 화면 건수(usedCount) 최신성', () => {
  test('기록 탭에서 거래를 저장한 뒤 관리 화면으로 가면 해당 카테고리 건수·확인 문구가 최신이다', async ({ browser }, testInfo) => {
    const { page, ctx, ctl } = await openApp(browser, testInfo);
    await waitChips(page, 8);
    await page.locator('#amount').fill('7000');
    await page.locator('#category-chips button', { hasText: '교통' }).click();
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await goManager(page);
    await expect(rowByName(page, '교통').locator('.cat-used')).toHaveText('기록 1건'); // 관리 화면 진입 시 서버 값으로 갱신되어야 한다
    await rowByName(page, '교통').getByRole('button', { name: '교통 이름 바꾸기' }).click();
    await expect(page.locator('.cat-rename ~ .hint')).toHaveText('지난 기록 1건도 새 이름으로 바뀌어요.');
    await page.keyboard.press('Escape');
    await rowByName(page, '교통').getByRole('button', { name: '교통 사용 안 함' }).click();
    await expect.poll(() => ctl.messages.length).toBe(1);
    expect(ctl.messages[0]).toContain('기록 1건');
    await ctx.close();
  });
});

// ============================================================ C-C24 비활성 거래 수정
test.describe('C-C24 사용 안 함 카테고리 거래 수정', () => {
  test('C-C24 "(사용 안 함)" 칩이 선택 상태로 보이고 금액만 바꿔 저장 성공, 다른 칩을 누르면 사라진다', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      prepare: async (api) => {
        await mkCat(api, 'expense', '경조사');
        await addTx(api, { category: '경조사', amount: 50000, memo: '축의금', date: FIXED_TODAY });
        await setActive(api, 'expense', '경조사', false);
      },
    });
    await waitChips(page, 8);
    expect(await chipNames(page)).not.toContain('경조사 (사용 안 함)');
    await page.locator('#tx-list .tx-edit').first().click();
    const legacy = page.locator('#category-chips button', { hasText: '경조사 (사용 안 함)' });
    await expect(legacy).toHaveCount(1);
    await expect(legacy).toHaveAttribute('aria-pressed', 'true');
    expect((await chipNames(page)).at(-1)).toBe('경조사 (사용 안 함)');
    await page.locator('#amount').fill('60000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    await expect(page.locator('#tx-list')).toContainText('60,000원');
    await expect(page.locator('#tx-list')).toContainText('경조사');
    await expect(page.locator('#category-chips button', { hasText: '사용 안 함' })).toHaveCount(0); // 저장 후 사라짐
    // 다시 수정 모드 -> 다른 칩 선택 시 비활성 칩이 사라진다
    await page.locator('#tx-list .tx-edit').first().click();
    await expect(page.locator('#category-chips button', { hasText: '경조사 (사용 안 함)' })).toHaveCount(1);
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await expect(page.locator('#category-chips button', { hasText: '경조사 (사용 안 함)' })).toHaveCount(0);
    await expect(page.locator('#category-chips button', { hasText: '식비' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    await expect(page.locator('#tx-list .tx-row').first()).toContainText('식비');
    await ctx.close();
  });

  test('C-C24 수정 취소 후에도 비활성 칩이 사라진다', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      prepare: async (api) => {
        await mkCat(api, 'expense', '경조사');
        await addTx(api, { category: '경조사', amount: 50000, date: FIXED_TODAY });
        await setActive(api, 'expense', '경조사', false);
      },
    });
    await waitChips(page, 8);
    await page.locator('#tx-list .tx-edit').first().click();
    await expect(page.locator('#category-chips button', { hasText: '경조사 (사용 안 함)' })).toHaveCount(1);
    await page.locator('#cancel-edit-btn').click();
    await expect(page.locator('#category-chips button', { hasText: '사용 안 함' })).toHaveCount(0);
    await ctx.close();
  });

  test('C-C24 수정 중 선택 카테고리가 관리 화면에서 사용 안 함이 되면 선택이 해제된다(신규 입력)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo);
    await waitChips(page, 8);
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await expect(page.locator('#category-chips button[aria-pressed="true"]')).toHaveText('식비');
    await goManager(page);
    await rowByName(page, '식비').getByRole('button', { name: '식비 사용 안 함' }).click();
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    await goRecord(page);
    await waitChips(page, 7);
    await expect(page.locator('#category-chips button[aria-pressed="true"]')).toHaveCount(0);
    await page.locator('#amount').fill('1000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#category-error')).toHaveText(/./); // 카테고리를 골라 달라는 안내
    await ctx.close();
  });
});

// ============================================================ C-C25 키보드
test.describe('C-C25 키보드만으로 전 흐름', () => {
  async function tabTo(page, predicate, max = 80, shift = false) {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
      const ok = await page.evaluate(predicate);
      if (ok) return i + 1;
    }
    throw new Error(`tabTo: 포커스 이동 실패 (${predicate})`);
  }
  const focusedIs = (label) => `(() => { const a = document.activeElement; return !!a && (a.getAttribute('aria-label') === ${JSON.stringify(label)} || a.textContent.trim() === ${JSON.stringify(label)}); })()`;

  test('C-C25 진입(편집 링크) -> 추가 -> 이름 바꾸기(Esc 취소, Enter 저장) -> 사용 안 함(취소/확인) -> 다시 사용 -> 기록으로', async ({ browser }, testInfo) => {
    const { page, ctx, ctl } = await openApp(browser, testInfo, {
      prepare: async (api) => { await addTx(api, { category: '식비', amount: 3000, date: FIXED_TODAY }); },
    });
    await waitChips(page, 8);
    // 1) "편집" 링크로 Tab 이동, Enter 로 진입
    await page.locator('#amount').focus();
    await tabTo(page, `document.activeElement.classList.contains('cat-edit-link')`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel-categories')).toBeVisible();
    await expect(page.locator('#cat-title')).toBeFocused();
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    // 2) 추가: 입력칸까지 Tab, 입력 후 Enter
    await tabTo(page, `document.activeElement.id === 'catm-name'`);
    await page.keyboard.type('키보드추가');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'키보드추가' 카테고리를 추가했어요");
    expect((await activeNames(page)).at(-1)).toBe('키보드추가');
    // 3) 이름 바꾸기: 식비 행의 버튼까지 Shift+Tab/Tab 이동 -> Space 로 시작(전체 선택) -> Esc 취소 -> 포커스 복귀
    await page.locator('#cat-title').focus();
    await tabTo(page, focusedIs('식비 이름 바꾸기'));
    await page.keyboard.press('Space');
    const input = page.locator('.cat-rename input');
    await expect(input).toBeFocused();
    expect(await input.evaluate((e) => [e.selectionStart, e.selectionEnd, e.value.length])).toEqual([0, 2, 2]); // 전체 선택
    await expect(page.locator('.cat-rename ~ .hint')).toContainText('지난 기록 1건도 새 이름으로 바뀌어요.');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cat-rename')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '식비 이름 바꾸기', exact: true })).toBeFocused();
    // Enter 저장
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await page.keyboard.type('밥값');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toContainText('식비 → 밥값');
    await expect(page.getByRole('button', { name: '밥값 이름 바꾸기', exact: true })).toBeFocused();
    // 4) 사용 안 함: 확인 대화상자 취소 -> 변화 없음
    await tabTo(page, focusedIs('밥값 사용 안 함'));
    ctl.accept = false;
    await page.keyboard.press('Enter');
    await expect.poll(() => ctl.messages.length).toBe(1);
    expect(await activeNames(page)).toContain('밥값');
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (0)');
    await expect(page.getByRole('button', { name: '밥값 사용 안 함', exact: true })).toBeFocused();
    // 확인 -> 포커스가 같은 자리의 다음 행으로
    ctl.accept = true;
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    expect(await activeNames(page)).not.toContain('밥값');
    const focusRow = await page.evaluate(() => document.activeElement.closest('.cat-row')?.querySelector('.cat-name')?.textContent);
    expect(focusRow).toBe('카페/간식'); // 밥값 다음 행
    // 5) 다시 사용: details 를 키보드로 열고 버튼에 Enter
    await tabTo(page, `document.activeElement.id === 'catm-inactive-title'`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-inactive-details')).toHaveAttribute('open', '');
    await tabTo(page, focusedIs('밥값 다시 사용'), 5);
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (0)');
    expect(await activeNames(page)).toContain('밥값');
    // 6) 기록으로 복귀 (← 기록으로 링크 Enter)
    await page.locator('#cat-title').focus();
    await tabTo(page, `document.activeElement.id === 'catm-back'`, 5, true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel-record')).toBeVisible();
    await waitChips(page, 9);
    expect(await chipNames(page)).toContain('밥값');
    expect(await chipNames(page)).toContain('키보드추가');
    // 이름 변경이 기록 목록에도 반영
    await expect(page.locator('#tx-list')).toContainText('밥값');
    await expect(page.locator('#tx-list')).not.toContainText('식비');
    await ctx.close();
  });

  test('C-C25 브라우저 뒤로가기로 관리 화면에서 기록으로 복귀', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo);
    await waitChips(page, 8);
    await goManager(page);
    await page.goBack();
    await expect(page.locator('#panel-record')).toBeVisible();
    await expect(page.locator('#panel-categories')).toBeHidden();
    await ctx.close();
  });

  test('C-C25 대시보드의 "카테고리 관리" 링크로도 진입, 하단 탭은 2개 유지', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#dashboard' });
    await page.getByRole('link', { name: '카테고리 관리' }).click();
    await expect(page.locator('#panel-categories')).toBeVisible();
    expect(await page.locator('nav.tabbar a').count()).toBe(2);
    await ctx.close();
  });

  test('C-C25 이름 바꾸기 입력 aria: 라벨, describedby(안내/오류), 오류 시 aria-invalid, 추가 입력 aria-invalid', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    await rowByName(page, '식비').getByRole('button', { name: '식비 이름 바꾸기' }).click();
    const input = page.locator('.cat-rename input');
    await expect(input).toHaveAccessibleName('식비 새 이름');
    const described = await input.getAttribute('aria-describedby');
    expect(described.split(' ')).toHaveLength(2);
    await input.fill('교통'); // 중복
    await page.locator('.cat-rename').getByRole('button', { name: /이름 저장/ }).click();
    const err = page.locator('.cat-row [role="alert"]', { hasText: '이미 같은 이름' });
    await expect(err).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveValue('교통'); // 입력값 유지
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    // 추가 입력 빈 값
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-add-error')).toHaveText('카테고리 이름을 입력해 주세요.');
    await expect(page.locator('#catm-name')).toHaveAttribute('aria-invalid', 'true');
    await ctx.close();
  });
});

// ============================================================ C-C26 이중 제출
test.describe('C-C26 이중 제출 방어', () => {
  test('C-C26 [추가] 더블클릭 + Enter 연타 -> POST /api/categories 1회, 카테고리 1개', async ({ browser }, testInfo) => {
    const { page, ctx, api } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/categories') posts.push(r.postData()); });
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await page.locator('#catm-name').fill('더블');
    await page.locator('#catm-add-btn').dblclick();
    await expect(page.locator('#catm-status')).toHaveText("'더블' 카테고리를 추가했어요");
    expect(posts).toHaveLength(1);
    expect((await listCats(api)).items.filter((i) => i.name === '더블')).toHaveLength(1);
    // Enter 연타
    await page.locator('#catm-name').fill('연타');
    await page.locator('#catm-name').press('Enter');
    await page.locator('#catm-name').press('Enter');
    await page.locator('#catm-name').press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'연타' 카테고리를 추가했어요");
    expect(posts).toHaveLength(2);
    expect((await listCats(api)).items.filter((i) => i.name === '연타')).toHaveLength(1);
    await ctx.close();
  });

  test('C-C26 이름 저장 Enter 연타, 사용 안 함 더블클릭 -> PATCH 각 1회', async ({ browser }, testInfo) => {
    const { page, ctx, api } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const patches = [];
    page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.postData()); });
    await page.route('**/api/categories/*', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await rowByName(page, '식비').getByRole('button', { name: '식비 이름 바꾸기' }).click();
    const input = page.locator('.cat-rename input');
    await input.fill('식사');
    await input.press('Enter');
    await input.press('Enter');
    await input.press('Enter');
    await expect(page.locator('#catm-status')).toContainText('식비 → 식사');
    expect(patches).toHaveLength(1);
    await rowByName(page, '교통').getByRole('button', { name: '교통 사용 안 함' }).dblclick();
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    expect(patches).toHaveLength(2);
    expect((await listCats(api)).items.filter((i) => i.name === '교통' && !i.active)).toHaveLength(1);
    await ctx.close();
  });

  test('C-C26 기록 저장 이중 제출은 기존 D2 와 동일하게 1회 (회귀)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo);
    await waitChips(page, 8);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/transactions') posts.push(1); });
    await page.route('**/api/transactions', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await page.locator('#amount').fill('1000');
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await page.locator('#category-chips button', { hasText: '식비' }).press('Enter');
    await page.locator('#category-chips button', { hasText: '식비' }).press('Enter');
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    expect(posts).toHaveLength(1);
    await ctx.close();
  });
});

// ============================================================ C-C27 오류 표시
test.describe('C-C27 오류 표시', () => {
  test('C-C27 중복 추가 -> role=alert 서버 문구, 입력값 유지. 한도 초과 -> 서버 문구', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    await page.locator('#catm-name').fill('식비');
    await page.locator('#catm-add-btn').click();
    const err = page.locator('#catm-add-error');
    await expect(err).toHaveText('이미 같은 이름의 카테고리가 있어요.');
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(page.locator('#catm-name')).toHaveValue('식비');
    await expect(page.locator('#catm-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#catm-restore')).toBeHidden();
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(8);
    await ctx.close();
  });

  test('C-C27 CATEGORY_INACTIVE: [다시 사용] 버튼이 나타나고 누르면 활성화', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#categories',
      prepare: async (api) => { await setActive(api, 'expense', '교통', false); },
    });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    expect(await activeNames(page)).not.toContain('교통');
    await page.locator('#catm-name').fill('교통');
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-add-error')).toHaveText('같은 이름의 사용 안 함 카테고리가 있어요.');
    const restore = page.locator('#catm-restore-btn');
    await expect(restore).toBeVisible();
    await expect(restore).toHaveAccessibleName('같은 이름의 사용 안 함 카테고리 다시 사용');
    await restore.click();
    await expect(page.locator('#catm-status')).toHaveText("'교통' 카테고리를 다시 사용해요");
    expect(await activeNames(page)).toContain('교통');
    await expect(page.locator('#catm-restore')).toBeHidden();
    await expect(page.locator('#catm-add-error')).toHaveText('');
    await ctx.close();
  });

  test('C-C27 마지막 활성 사용 안 함 -> 행 오류 "카테고리가 하나는 있어야 해요." (버튼은 숨기지 않는다)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#categories',
      prepare: async (api) => { for (const n of ['용돈', '부수입', '기타']) await setActive(api, 'income', n, false); },
    });
    await page.locator('#catm-income').click();
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(1);
    const btn = page.getByRole('button', { name: '급여 사용 안 함', exact: true });
    await expect(btn).toBeVisible();
    await btn.click();
    const err = page.locator('#catm-active .cat-row [role="alert"]', { hasText: '카테고리가 하나는 있어야 해요' });
    await expect(err).toBeVisible();
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(1);
    await ctx.close();
  });

  test('C-C27 이름 15자 초과/빈 이름은 클라이언트에서 막고 요청을 보내지 않는다', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(1); });
    await page.locator('#catm-name').fill('가'.repeat(16));
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-add-error')).toHaveText('카테고리 이름은 15자까지 쓸 수 있어요.');
    await page.locator('#catm-name').fill('   ');
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-add-error')).toHaveText('카테고리 이름을 입력해 주세요.');
    expect(posts).toHaveLength(0);
    await ctx.close();
  });

  test('C-C27 로그인 만료(401) 시 관리 화면에서 변경하면 로그인 화면으로', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    await ctx.clearCookies();
    await page.locator('#catm-name').fill('만료테스트');
    await page.locator('#catm-add-btn').click();
    await page.waitForURL((u) => u.pathname.endsWith('/login.html'), { timeout: 10_000 });
    await ctx.close();
  });
});

// ============================================================ C-C28 360px
test.describe('C-C28 레이아웃(360px: 가로 스크롤 없음, 터치 영역 44x44)', () => {
  const longNames = (n) => Array.from({ length: n }, (_, i) => `${'긴이름가나다라마바사'}${String(i).padStart(2, '0')}`.slice(0, 15));
  async function thirty(api) {
    // 지출 활성 30개 (기본 8 + 22). 15자 이름 포함
    for (const n of longNames(22)) await mkCat(api, 'expense', n);
    await addTx(api, { category: longNames(22)[3], amount: 5000, date: FIXED_TODAY });
  }
  const smallTargets = (page, scope) => page.evaluate((sel) => {
    const out = [];
    for (const b of document.querySelectorAll(`${sel} button, ${sel} a.btn, ${sel} summary, ${sel} input[type=text]`)) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${b.tagName} "${(b.getAttribute('aria-label') || b.textContent || b.id).trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);

  test('C-C28 관리 화면(지출 활성 30개, 15자 이름): scrollWidth <= viewport, 모든 버튼 44x44 이상', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories', prepare: thirty });
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(30);
    await expect(page.locator('#catm-list-title')).toHaveText('사용 중인 지출 카테고리 30/30');
    await expectNoHorizontalScroll(page, w);
    expect(await smallTargets(page, '#panel-categories')).toEqual([]);
    // 이름 바꾸기 편집 상태, 사용 안 함 목록 펼침, 오류 표시 상태도 가로 스크롤 없음
    await rowByName(page, longNames(22)[3]).getByRole('button', { name: /이름 바꾸기/ }).click();
    await expectNoHorizontalScroll(page, w);
    expect(await smallTargets(page, '#panel-categories')).toEqual([]);
    await page.keyboard.press('Escape');
    await page.locator('#catm-income').click();
    await expectNoHorizontalScroll(page, w);
    // 30개 상태에서 추가 -> 한도 오류 문구도 폭 안에
    await page.locator('#catm-expense').click();
    await page.locator('#catm-name').fill('서른하나');
    await page.locator('#catm-name').press('Enter'); // 30개면 추가 버튼이 aria-disabled(비활성 모양)라 Playwright click 이 멈춘다. 같은 제출 경로인 Enter 로 시험한다
    await expect(page.locator('#catm-add-error')).toContainText('30개까지');
    await expectNoHorizontalScroll(page, w);
    await ctx.close();
  });

  test('C-C28 기록 칩 30개 + 15자 이름, 대시보드 각각 가로 스크롤 없음', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const { page, ctx } = await openApp(browser, testInfo, { prepare: thirty });
    await waitChips(page, 30);
    await expectNoHorizontalScroll(page, w);
    expect(await smallTargets(page, '#category-chips')).toEqual([]);
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await expectNoHorizontalScroll(page, w);
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut')).toBeVisible();
    await expectNoHorizontalScroll(page, w);
    await page.goto('/#record');
    await expectNoHorizontalScroll(page, w);
    await expectNoBadNumbers(page);
    await ctx.close();
  });

  test('C-C28 대시보드 카테고리 보기 토글/관리 링크 터치 영역 44x44 이상, 기록 폼 "편집" 링크 44x44 이상', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#dashboard' });
    await expect(page.locator('#catview-expense')).toBeVisible();
    expect(await smallTargets(page, '.catview-head')).toEqual([]);
    for (const id of ['#catview-expense', '#catview-income']) {
      const r = await page.locator(id).boundingBox();
      expect(r.width).toBeGreaterThanOrEqual(43.5);
      expect(r.height).toBeGreaterThanOrEqual(43.5);
    }
    await page.goto('/#record');
    await waitChips(page, 8);
    const e = await page.locator('a.cat-edit-link').boundingBox();
    expect(e.width).toBeGreaterThanOrEqual(43.5);
    expect(e.height).toBeGreaterThanOrEqual(43.5);
    await ctx.close();
  });
});

// ============================================================ C-C29 CSP/XSS
test.describe('C-C29 CSP·XSS', () => {
  test('C-C29 index.html 정적 검사: 인라인 script / on*= / style= 속성 없음', async () => {
    const api = await newApi();
    const html = await (await get(api, '/')).text();
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) expect(m[1]).toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<[^>]+\sstyle\s*=/i);
    expect(html).not.toMatch(/<style\b/i);
    // 관리 패널 마크업이 정적 HTML 에 있다
    expect(html).toContain('id="panel-categories"');
  });

  test('C-C29 JS 소스에도 innerHTML / insertAdjacentHTML / eval / .style.cssText 사용 없음 (CSP 위반 소지)', async () => {
    const api = await newApi();
    for (const f of ['categories.js', 'category-manager.js', 'record.js', 'dashboard.js', 'charts.js', 'lib/categories-data.js', 'lib/viz.js', 'dom.js', 'tabs.js']) {
      const src = await (await get(api, `/js/${f}`)).text();
      expect(src.replace(/\/\/.*$/gm, ''), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(/);
    }
  });

  const XSS = ['<b onclick=x>', '<i onfocus=1>', '"><u>x</u>'];
  test('C-C29 꺾쇠 이름이 칩·관리 목록·도넛 범례·표·추이 칩에 글자 그대로, 요소 생성 없음, dialog 없음, CSP 위반 0', async ({ browser }, testInfo) => {
    const { page, ctx, ctl, consoleErrors } = await openApp(browser, testInfo, {
      prepare: async (api) => {
        for (const n of XSS) {
          await mkCat(api, 'expense', n);
          await addTx(api, { category: n, amount: 30000, memo: n, date: FIXED_TODAY });
        }
        await mkCat(api, 'income', XSS[0]);
        await addTx(api, { type: 'income', category: XSS[0], amount: 90000, date: FIXED_TODAY });
      },
    });
    await waitChips(page, 11);
    const noInjected = () => page.evaluate(() => document.querySelectorAll('b[onclick], i[onfocus], u').length);
    expect(await chipNames(page)).toEqual(expect.arrayContaining(XSS));
    expect(await noInjected()).toBe(0);
    await expect(page.locator('#tx-list')).toContainText(XSS[0]);
    await expect(page.locator('#month-summary')).toContainText(XSS[1]);
    // 관리 목록 / 이름 바꾸기 입력 / 확인창
    await goManager(page);
    expect(await activeNames(page)).toEqual(expect.arrayContaining(XSS));
    expect(await noInjected()).toBe(0);
    await rowByName(page, XSS[0]).getByRole('button', { name: `${XSS[0]} 이름 바꾸기` }).click();
    await expect(page.locator('.cat-rename input')).toHaveValue(XSS[0]);
    await page.keyboard.press('Escape');
    await rowByName(page, XSS[1]).getByRole('button', { name: `${XSS[1]} 사용 안 함` }).click();
    await expect.poll(() => ctl.messages.length).toBe(1);
    expect(ctl.messages[0]).toContain(XSS[1]);
    await expect(page.locator('#catm-inactive')).toContainText(XSS[1]);
    expect(await noInjected()).toBe(0);
    // 대시보드: 도넛 범례, 표, 추이 칩, svg title/desc
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    const legend = await page.locator('#chart-donut .legend-label').allTextContents();
    expect(legend).toEqual(expect.arrayContaining(XSS));
    await page.locator('#chart-donut details summary').click();
    const rows = await page.locator('#chart-donut table tbody th').allTextContents();
    expect(rows).toEqual(expect.arrayContaining(XSS));
    expect(await page.locator('#cat-trend-chips button').allTextContents()).toEqual(expect.arrayContaining(XSS));
    expect(await noInjected()).toBe(0);
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut .legend-label').first()).toHaveText(XSS[0]);
    expect(await noInjected()).toBe(0);
    // 클릭해도 인라인 핸들러가 없다
    await page.goto('/#record');
    await page.locator('#category-chips button', { hasText: XSS[0] }).click();
    expect(ctl.all.filter((d) => d.type !== 'confirm')).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    expect(consoleErrors.filter((t) => /Content Security Policy|Refused/i.test(t))).toEqual([]);
    expect(page.__errors || []).toEqual([]);
    await ctx.close();
  });

  test('C-C29 전 흐름 동안 CSP 위반 0건, 페이지 오류 0건 (추가/이름 변경/사용 안 함/다시 사용/수정/대시보드 전환)', async ({ browser }, testInfo) => {
    const { page, ctx, consoleErrors } = await openApp(browser, testInfo, {
      prepare: async (api) => { await addTx(api, { category: '식비', amount: 1000, date: FIXED_TODAY }); await addTx(api, { type: 'income', category: '급여', amount: 5000, date: FIXED_TODAY }); },
    });
    await waitChips(page, 8);
    await goManager(page);
    await page.locator('#catm-name').fill('흐름');
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-status')).toContainText('추가했어요');
    await rowByName(page, '흐름').getByRole('button', { name: '흐름 이름 바꾸기' }).click();
    await page.locator('.cat-rename input').fill('흐름2');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toContainText('흐름 → 흐름2');
    await rowByName(page, '흐름2').getByRole('button', { name: '흐름2 사용 안 함' }).click();
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    await page.locator('#catm-inactive-details summary').click();
    await page.getByRole('button', { name: '흐름2 다시 사용' }).click();
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (0)');
    await page.locator('#catm-income').click();
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
    await page.goto('/#record');
    await page.locator('#tx-list .tx-edit').first().click();
    expect(await cspViolations(page)).toEqual([]);
    expect(consoleErrors.filter((t) => /Content Security Policy|Refused|violat/i.test(t))).toEqual([]);
    expect(page.__errors || []).toEqual([]);
    await ctx.close();
  });
});

// ============================================================ C-C30 도넛 묶음
test.describe('C-C30 도넛 "그 외 N개" 묶음', () => {
  async function twelve(api) {
    // 지출 12개 카테고리(기본 8 + 4), 금액이 모두 다르다. "기타"는 상위 7에 든다.
    for (const n of ['반려동물', '구독', '보험', '세금']) await mkCat(api, 'expense', n);
    const amounts = [['식비', 120000], ['기타', 110000], ['교통', 100000], ['쇼핑', 90000], ['주거/통신', 80000], ['의료/건강', 70000], ['문화/여가', 60000],
      ['카페/간식', 50000], ['반려동물', 40000], ['구독', 30000], ['보험', 20000], ['세금', 10000]];
    for (const [category, amount] of amounts) await addTx(api, { category, amount, date: '2026-10-05' });
    return amounts;
  }
  test('C-C30 12개 카테고리: path 8, 범례 8행, 마지막 "그 외 5개"(기타 아님)+묶인 이름, fill 8개 모두 다름, 표 12행+합계, 합 = 총지출', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#dashboard', prepare: twelve });
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    expect(await page.locator('#chart-donut svg.chart-svg > path').count()).toBe(8);
    const labels = await page.locator('#chart-donut .legend-label').allTextContents();
    expect(labels).toHaveLength(8);
    expect(labels).toEqual(['식비', '기타', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '그 외 5개']);
    expect(labels.at(-1)).not.toBe('기타');
    // 사용자 카테고리 "기타"는 상위 7에 있어 별도 행
    expect(labels.filter((l) => l === '기타')).toHaveLength(1);
    const members = await page.locator('#chart-donut .legend-members').allTextContents();
    expect(members).toHaveLength(1);
    expect(members[0].split(',').map((s) => s.trim())).toEqual(['카페/간식', '반려동물', '구독', '보험', '세금']);
    // (색, 무늬) 조합 중복 금지: 디자인 적용 후 색은 클래스/패턴 안의 viz-fill-N 이라 fill 속성만으로는 구분되지 않는다. 서명으로 비교
    const sigs = await sliceSignatures(page);
    expect(new Set(sigs).size).toBe(8);
    const vizNos = await page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-viz')));
    expect(new Set(vizNos).size).toBe(8);
    expect(vizNos.at(-1)).toBe('other'); // "그 외 N개" 는 중립 단색
    // 표: 묶지 않은 전체 12행 + 합계
    await page.locator('#chart-donut details summary').click();
    const rows = await page.locator('#chart-donut table tbody tr').count();
    expect(rows).toBe(12);
    const body = await page.locator('#chart-donut table tbody tr').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('th').textContent, tr.querySelector('td').textContent]));
    const total = 780000;
    expect(body.reduce((a, [, amt]) => a + Number(amt.replace(/\D/g, '')), 0)).toBe(total);
    await expect(page.locator('#chart-donut table tfoot')).toContainText('합계');
    await expect(page.locator('#chart-donut table tfoot')).toContainText('780,000원');
    await expect(page.locator('#chart-donut svg text.donut__value')).toHaveText('780,000원');
    // 묶음 조각 금액 = 하위 5개 합
    const other = page.locator('#chart-donut .legend li').last();
    await expect(other.locator('.legend-amount')).toHaveText('150,000원');
    // 도넛 요약/타이틀 접근성
    await expect(page.locator('#chart-donut svg[role="img"] desc')).toHaveText(/^2026년 10월 지출 780,000원 중 식비 15\.4%로 가장 큼$/);
    await ctx.close();
  });

  test('C-C30 금액 있는 카테고리가 8개면 묶음 없이 8조각, 9개면 7+그 외 2개', async ({ browser }, testInfo) => {
    const eight = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (api) => { for (const [i, c] of ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'].entries()) await addTx(api, { category: c, amount: 10000 + i * 1000, date: '2026-10-05' }); },
    });
    await expect(eight.page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    expect(await eight.page.locator('#chart-donut svg.chart-svg > path').count()).toBe(8);
    expect((await eight.page.locator('#chart-donut .legend-label').allTextContents()).some((l) => l.startsWith('그 외'))).toBe(false);
    expect(await eight.page.locator('#chart-donut .legend-members').count()).toBe(0);
    await eight.ctx.close();
    const nine = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (api) => {
        await mkCat(api, 'expense', '아홉째');
        for (const [i, c] of ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', '아홉째'].entries()) await addTx(api, { category: c, amount: 20000 - i * 1000, date: '2026-10-05' });
      },
    });
    await expect(nine.page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    expect(await nine.page.locator('#chart-donut svg.chart-svg > path').count()).toBe(8);
    expect((await nine.page.locator('#chart-donut .legend-label').allTextContents()).at(-1)).toBe('그 외 2개');
    expect(new Set(await sliceSignatures(nine.page)).size).toBe(8);
    await nine.ctx.close();
  });

  test('C-C30 수입 보기에서도 같은 묶음 규칙 (수입 12개, "그 외 5개")', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (api) => {
        const extra = ['이자', '배당', '환급', '중고', '장학금', '상여', '보너스', '선물'];
        for (const n of extra) await mkCat(api, 'income', n);
        const all = ['급여', '용돈', '부수입', '기타', ...extra];
        for (const [i, c] of all.entries()) await addTx(api, { type: 'income', category: c, amount: 100000 - i * 5000, date: '2026-10-05' });
      },
    });
    await expect(page.locator('#chart-monthly svg.chart-svg')).toBeVisible();
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
    expect(await page.locator('#chart-donut svg.chart-svg > path').count()).toBe(8);
    expect((await page.locator('#chart-donut .legend-label').allTextContents()).at(-1)).toBe('그 외 5개');
    await page.locator('#chart-donut details summary').click();
    expect(await page.locator('#chart-donut table tbody tr').count()).toBe(12);
    await ctx.close();
  });
});

// ============================================================ C-C32 관리 화면 대칭
test.describe('C-C32 수입·지출 대칭(관리 화면)', () => {
  test('C-C32 토글 두 버튼 크기 차 1px 이하, 유형별 컨트롤 구성 동일(입력 1, 추가 1, 행당 버튼 2, details 1)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const a = await page.locator('#catm-expense').boundingBox();
    const b = await page.locator('#catm-income').boundingBox();
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    await expect(page.locator('#catm-expense')).toHaveAttribute('aria-pressed', 'true');
    const structure = async () => page.evaluate(() => ({
      nameInputs: document.querySelectorAll('#catm-add input').length,
      addButtons: document.querySelectorAll('#catm-add #catm-add-btn').length,
      rows: document.querySelectorAll('#catm-active .cat-row').length,
      rowButtons: [...document.querySelectorAll('#catm-active .cat-row')].map((r) => r.querySelectorAll('button').length),
      rowLabels: [...document.querySelectorAll('#catm-active .cat-row')].map((r) => [...r.querySelectorAll('button')].map((x) => x.textContent)),
      details: document.querySelectorAll('#panel-categories details').length,
      heading: document.getElementById('catm-list-title').textContent.replace(/지출|수입/, 'X').replace(/\d+\/30/, 'N/30'),
      addLabel: document.getElementById('catm-name-label').textContent.replace(/지출|수입/, 'X'),
    }));
    const exp = await structure();
    await page.locator('#catm-income').click();
    await expect(page.locator('#catm-income')).toHaveAttribute('aria-pressed', 'true');
    const inc = await structure();
    expect(inc.nameInputs).toBe(exp.nameInputs);
    expect(inc.nameInputs).toBe(1);
    expect(inc.addButtons).toBe(1);
    expect(inc.details).toBe(1);
    expect(exp.rowButtons.every((n) => n === 2)).toBe(true);
    expect(inc.rowButtons.every((n) => n === 2)).toBe(true);
    expect(inc.rowLabels.every((l) => l.join() === '이름 바꾸기,사용 안 함')).toBe(true);
    expect(inc.heading).toBe(exp.heading);
    expect(inc.addLabel).toBe(exp.addLabel);
    expect(exp.rows).toBe(8);
    expect(inc.rows).toBe(4);
    await ctx.close();
  });

  test('C-C32 같은 조작 순서(추가 -> 이름 변경 -> 사용 안 함 -> 다시 사용)가 두 유형에서 같은 클릭/키 수로 끝난다', async ({ browser }, testInfo) => {
    const { page, ctx, ctl } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const ops = {};
    for (const type of ['expense', 'income']) {
      let n = 0;
      const act = async (fn) => { n += 1; await fn(); };
      const label = type === 'expense' ? '지출' : '수입';
      await page.locator(`#catm-${type}`).click();
      const name = `${label}신규`; const renamed = `${label}변경`;
      await act(() => page.locator('#catm-name').fill(name)); // 입력 1
      await act(() => page.locator('#catm-name').press('Enter')); // 추가 1
      await expect(page.locator('#catm-status')).toHaveText(`'${name}' 카테고리를 추가했어요`);
      await act(() => rowByName(page, name).getByRole('button', { name: `${name} 이름 바꾸기` }).click());
      await act(() => page.locator('.cat-rename input').fill(renamed));
      await act(() => page.locator('.cat-rename input').press('Enter'));
      await expect(page.locator('#catm-status')).toContainText(`${name} → ${renamed}`);
      const before = ctl.messages.length;
      await act(() => rowByName(page, renamed).getByRole('button', { name: `${renamed} 사용 안 함` }).click()); // 확인창 자동 수락
      await expect.poll(() => ctl.messages.length).toBe(before + 1);
      await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
      await act(() => page.locator('#catm-inactive-details summary').click());
      await act(() => page.getByRole('button', { name: `${renamed} 다시 사용` }).click());
      await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (0)');
      expect(await activeNames(page)).toContain(renamed);
      ops[type] = n;
      await page.locator('#catm-inactive-details summary').click(); // 다음 유형을 위해 접기 (조작 수에 포함하지 않음)
      await expect(page.locator('#catm-inactive-details')).not.toHaveAttribute('open', '');
    }
    expect(ops.expense).toBe(ops.income);
    await ctx.close();
  });

  test('C-C32 수입 쪽 안내/빈 상태 문구가 지출 쪽과 같은 구조(사용 안 함 0개 문구)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    await page.locator('#catm-inactive-details summary').click();
    await expect(page.locator('#catm-inactive .empty-line')).toHaveText('사용 안 함인 지출 카테고리가 없어요');
    await page.locator('#catm-income').click();
    await expect(page.locator('#catm-inactive .empty-line')).toHaveText('사용 안 함인 수입 카테고리가 없어요');
    await ctx.close();
  });
});

// ============================================================ C-C33 대시보드 수입/지출 전환
test.describe('C-C33 대시보드 카테고리 보기 수입/지출', () => {
  async function incomeData(api) {
    for (const [c, a, d] of [['급여', 2000000, '2026-10-25'], ['용돈', 50000, '2026-10-03'], ['부수입', 300000, '2026-10-07'], ['급여', 1900000, '2026-09-25'], ['용돈', 70000, '2026-09-03']]) {
      await addTx(api, { type: 'income', category: c, amount: a, date: d });
    }
    for (const [c, a, d] of [['식비', 40000, '2026-10-02'], ['교통', 15000, '2026-10-03'], ['식비', 20000, '2026-09-02']]) await addTx(api, { category: c, amount: a, date: d });
  }
  test('C-C33 수입 선택 -> 제목 "카테고리 수입 비중", 중심 "총 수입", 범례=API, D4 칩/캡션 수입 기준, 다시 지출 복귀, 토글 크기 동일, 기본 지출', async ({ browser }, testInfo) => {
    const { page, ctx, api } = await openApp(browser, testInfo, { hash: '#dashboard', prepare: incomeData });
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    // 기본 지출
    await expect(page.locator('#catview-expense')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#catview-income')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 지출 비중');
    await expect(page.locator('#chart-donut svg text.chart-text-sub')).toHaveText('총 지출');
    const a = await page.locator('#catview-expense').boundingBox();
    const b = await page.locator('#catview-income').boundingBox();
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    const expLegend = await page.locator('#chart-donut .legend-label').allTextContents();
    const trendChipsExp = await page.locator('#cat-trend-chips button').allTextContents();
    // 수입 선택
    await page.locator('#catview-income').click();
    await expect(page.locator('#catview-income')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
    await expect(page.locator('#chart-donut')).toHaveAttribute('aria-label', '카테고리 수입 비중');
    await expect(page.locator('#chart-donut svg text.chart-text-sub')).toHaveText('총 수입');
    const st = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10&type=income')).json();
    const legend = await page.locator('#chart-donut .legend li').evaluateAll((lis) => lis.map((li) => ({
      label: li.querySelector('.legend-label').textContent.trim(), amount: li.querySelector('.legend-amount').textContent.trim(), ratio: li.querySelector('.legend-ratio').textContent.trim(),
    })));
    expect(legend.map((l) => l.label)).toEqual(st.items.map((i) => i.category));
    expect(legend.map((l) => l.amount)).toEqual(st.items.map((i) => `${i.total.toLocaleString('en-US')}원`));
    expect(legend.map((l) => l.ratio)).toEqual(st.items.map((i) => `${((i.total / st.grandTotal) * 100).toFixed(1)}%`));
    await expect(page.locator('#chart-donut svg text.donut__value')).toHaveText(`${st.grandTotal.toLocaleString('en-US')}원`);
    await expect(page.locator('#chart-donut svg[role="img"] desc')).toHaveText(/^2026년 10월 수입 [\d,]+원 중 급여 .+로 가장 큼$/);
    // D4: 수입 기준 칩/캡션
    const trendChips = await page.locator('#cat-trend-chips button').allTextContents();
    expect(trendChips).toEqual(['급여', '부수입', '용돈']);
    expect(trendChips).not.toEqual(trendChipsExp);
    await expect(page.locator('#chart-cat-trend figcaption')).toHaveText('급여 월별 수입 추이');
    await page.locator('#cat-trend-chips button', { hasText: '용돈' }).click();
    await expect(page.locator('#chart-cat-trend figcaption')).toHaveText('용돈 월별 수입 추이');
    // 월 이동/기간 변경에도 유지
    await page.locator('#range-12').click();
    await expect(page.locator('#catview-income')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
    await page.locator('#range-6').click();
    // 탭 이동 사이 선택 유지
    await page.goto('/#record');
    await expect(page.locator('#panel-record')).toBeVisible();
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
    // 지출로 복귀
    await page.locator('#catview-expense').click();
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 지출 비중');
    expect(await page.locator('#chart-donut .legend-label').allTextContents()).toEqual(expLegend);
    await expect(page.locator('#chart-cat-trend figcaption')).toContainText('월별 지출 추이');
    await expectNoBadNumbers(page);
    await ctx.close();
  });

  test('C-C33 수입 기록이 없는 달: 수입 보기는 빈 상태 문구(NaN 없음), 지출로 돌아오면 정상', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#dashboard', prepare: async (api) => { await addTx(api, { category: '식비', amount: 5000, date: '2026-10-02' }); },
    });
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut .chart-empty')).toBeVisible();
    await expect(page.locator('#chart-cat-trend .chart-empty')).toBeVisible();
    await expectNoBadNumbers(page);
    await page.locator('#catview-expense').click();
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await ctx.close();
  });

  test('C-C33 새로고침하면 선택은 지출로 돌아간다(OQ-C11 기본값)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#dashboard', prepare: incomeData });
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
    await page.reload();
    await expect(page.locator('#catview-expense')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 지출 비중');
    await ctx.close();
  });
});

// ============================================================ C-C34 기록 탭 수입 블록
test.describe('C-C34 기록 탭 "카테고리별 수입/지출" 블록', () => {
  test('C-C34 수입 거래가 있는 달: 수입 블록이 지출 블록 앞에, 같은 마크업 구조, 금액·비율이 stats 와 일치', async ({ browser }, testInfo) => {
    const { page, ctx, api } = await openApp(browser, testInfo, {
      prepare: async (a) => {
        await addTx(a, { type: 'income', category: '급여', amount: 2000000, date: '2026-10-25' });
        await addTx(a, { type: 'income', category: '용돈', amount: 500000, date: '2026-10-03' });
        await addTx(a, { category: '식비', amount: 30000, date: '2026-10-02' });
        await addTx(a, { category: '교통', amount: 10000, date: '2026-10-03' });
      },
    });
    await expect(page.locator('#month-summary h3')).toHaveCount(2);
    expect(await page.locator('#month-summary h3').allTextContents()).toEqual(['카테고리별 수입', '카테고리별 지출']);
    const blocks = await page.locator('#month-summary').evaluate((box) => {
      const uls = [...box.querySelectorAll('ul.cat-bars')];
      return uls.map((ul) => ({
        prev: ul.previousElementSibling.tagName, rows: [...ul.children].map((li) => [li.querySelector('.cat-bar-name').textContent, li.querySelector('.cat-bar-amount').textContent,
          [...li.children].map((c) => c.className).join('|')]),
        fillClass: ul.querySelector('.bar-fill').className,
      }));
    });
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.prev === 'H3')).toBe(true);
    // 구조 동일(자식 클래스 구성)
    expect(new Set(blocks.flatMap((b) => b.rows.map((r) => r[2]))).size).toBe(1);
    const inc = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10&type=income')).json();
    const exp = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10&type=expense')).json();
    const fmt = (i) => `${i.total.toLocaleString('en-US')}원 (${(i.ratio * 100).toFixed(1)}%)`;
    expect(blocks[0].rows.map((r) => [r[0], r[1]])).toEqual(inc.items.map((i) => [i.category, fmt(i)]));
    expect(blocks[1].rows.map((r) => [r[0], r[1]])).toEqual(exp.items.map((i) => [i.category, fmt(i)]));
    expect(blocks[0].fillClass).toContain('income');
    expect(blocks[1].fillClass).toContain('expense');
    await ctx.close();
  });

  test('C-C34 수입 0이면 수입 블록이 같은 형식 빈 문구, 지출 0이면 지출 쪽이 대칭 문구', async ({ browser }, testInfo) => {
    const onlyExpense = await openApp(browser, testInfo, { prepare: async (a) => { await addTx(a, { category: '식비', amount: 5000, date: '2026-10-02' }); } });
    await expect(onlyExpense.page.locator('#month-summary h3')).toHaveCount(2);
    expect(await onlyExpense.page.locator('#month-summary h3').allTextContents()).toEqual(['카테고리별 수입', '카테고리별 지출']);
    await expect(onlyExpense.page.locator('#month-summary .empty-line')).toHaveText('이 달에는 수입 기록이 없어요');
    await onlyExpense.ctx.close();
    const onlyIncome = await openApp(browser, testInfo, { prepare: async (a) => { await addTx(a, { type: 'income', category: '급여', amount: 5000, date: '2026-10-02' }); } });
    expect(await onlyIncome.page.locator('#month-summary h3').allTextContents()).toEqual(['카테고리별 수입', '카테고리별 지출']);
    await expect(onlyIncome.page.locator('#month-summary .empty-line')).toHaveText('이 달에는 지출 기록이 없어요');
    await onlyIncome.ctx.close();
    const none = await openApp(browser, testInfo);
    expect(await none.page.locator('#month-summary .empty-line').allTextContents()).toEqual(['이 달에는 수입 기록이 없어요', '이 달에는 지출 기록이 없어요']);
    await expectNoBadNumbers(none.page);
    await none.ctx.close();
  });
});

// ============================================================ C-C35 KPI
test.describe('C-C35 KPI 증감 문구 대칭', () => {
  const kpiExtra = (page) => page.locator('#kpi .kpi').evaluateAll((els) => els.map((e) => ({
    label: e.querySelector('.kpi-label').textContent, extra: e.querySelector('.kpi-extra')?.textContent || '', cls: e.querySelector('.kpi-extra')?.className || '',
  })));
  test('C-C35 전월 수입·지출 모두 있음: 같은 문장 형식(늘었어요/줄었어요), ▲/▼ 방향 기호, 색은 본문색', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (a) => {
        await addTx(a, { type: 'income', category: '급여', amount: 1000000, date: '2026-09-25' });
        await addTx(a, { type: 'income', category: '급여', amount: 1100000, date: '2026-10-05' });
        await addTx(a, { category: '식비', amount: 100000, date: '2026-09-05' });
        await addTx(a, { category: '식비', amount: 80000, date: '2026-10-05' });
      },
    });
    await expect(page.locator('#kpi .kpi')).toHaveCount(3);
    const k = await kpiExtra(page);
    // 균형 카드(OQ-D12): DOM·화면 순서 = 남은 돈 -> 수입 -> 지출. 남은 돈 칸에는 전월 대비 문구가 없다.
    expect(k.map((x) => x.label)).toEqual(['이번 달 남은 돈', '수입', '지출']);
    expect(k[0].extra).toBe('');
    expect(k[1].extra).toBe('▲ 지난달보다 수입이 10.0% 늘었어요');
    expect(k[2].extra).toBe('▼ 지난달보다 지출이 20.0% 줄었어요');
    const fmt = /^[▲▼=] 지난달(보다 (수입|지출)이 \d+\.\d% (늘었어요|줄었어요)|과 같아요)$/;
    expect(k[1].extra).toMatch(fmt);
    expect(k[2].extra).toMatch(fmt);
    // 색: 수입·지출 증감 모두 같은 computed color (가치 판단 색 아님)
    const colors = await page.locator('#kpi .kpi-extra').evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    expect(new Set(colors).size).toBe(1);
    expect(colors[0]).not.toBe(DANGER);
    expect(colors[0]).not.toBe(DANGER_DARK);
    expect(colors[0]).not.toBe(OK);
    await ctx.close();
  });

  test('C-C35 전월 0: 두 카드 모두 "비교할 지난달 기록이 없어요", 한쪽만 0이면 그 카드만', async ({ browser }, testInfo) => {
    const none = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (a) => { await addTx(a, { type: 'income', category: '급여', amount: 1000000, date: '2026-10-05' }); await addTx(a, { category: '식비', amount: 10000, date: '2026-10-06' }); },
    });
    await expect(none.page.locator('#kpi .kpi')).toHaveCount(3);
    const k = await kpiExtra(none.page);
    expect(k[1].extra).toBe('비교할 지난달 기록이 없어요'); // k[0] = 남은 돈 칸
    expect(k[2].extra).toBe('비교할 지난달 기록이 없어요');
    await none.ctx.close();
    const mixed = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (a) => {
        await addTx(a, { type: 'income', category: '급여', amount: 1000000, date: '2026-10-05' });
        await addTx(a, { category: '식비', amount: 10000, date: '2026-09-06' });
        await addTx(a, { category: '식비', amount: 12000, date: '2026-10-06' });
      },
    });
    await expect(mixed.page.locator('#kpi .kpi')).toHaveCount(3);
    const m = await kpiExtra(mixed.page);
    expect(m[1].extra).toBe('비교할 지난달 기록이 없어요');
    expect(m[2].extra).toBe('▲ 지난달보다 지출이 20.0% 늘었어요');
    await mixed.ctx.close();
  });

  test('C-C35 전월과 같으면 "지난달과 같아요" (수입·지출 대칭)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (a) => {
        for (const m of ['09', '10']) { await addTx(a, { type: 'income', category: '급여', amount: 500000, date: `2026-${m}-05` }); await addTx(a, { category: '식비', amount: 7000, date: `2026-${m}-06` }); }
      },
    });
    await expect(page.locator('#kpi .kpi')).toHaveCount(3);
    const k = await kpiExtra(page);
    expect(k[1].extra).toBe('= 지난달과 같아요');
    expect(k[2].extra).toBe('= 지난달과 같아요');
    await ctx.close();
  });
});

// ============================================================ C-C36 가치 중립 색
test.describe('C-C36 가치 중립 색 (빨강/초록 의존 없음)', () => {
  test('C-C36 CSS/JS 정적: --color-error 는 오류 문구·삭제 버튼·오류 입력에만, --ok·옛 색 없음, JS/style.css 에 hex 색 없음', async () => {
    const api = await newApi();
    const css = await (await get(api, '/css/style.css')).text();
    // style.css 의 --color-error 사용처 선택자 (components.css 는 원본 그대로: .btn--danger/.field__error/[aria-invalid] 만 쓰는지 따로 확인)
    const usesOf = (text0) => { const text = text0.replace(/\/\*[\s\S]*?\*\//g, ''); return [...text.matchAll(/([^{}]+)\{[^}]*var\(--color-error\)[^}]*\}/g)].map((m) => m[1].trim().replace(/\s+/g, ' ')); };
    const uses = usesOf(css);
    expect(uses.sort(), `--color-error 사용처: ${uses.join(' | ')}`).toEqual(['.amount-wrap:has(.amount-input[aria-invalid="true"])', '.btn-danger', '.error-text']);
    const comp = usesOf(await (await get(api, '/css/components.css')).text());
    for (const sel of comp) expect(sel, `components.css 사용처: ${sel}`).toMatch(/btn--danger|field__error|aria-invalid/);
    expect(css).not.toMatch(/var\(--ok\)|--ok\s*:|#0b6b3a|--danger/i);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/); // 하드코딩 색 0 (tokens.css 만 색을 정의한다)
    const tokens = await (await get(api, '/css/tokens.css')).text();
    expect(tokens.match(/--color-error:\s*#AC3A31/gi) || []).toHaveLength(1); // 라이트 정의 한 번
    for (const f of ['app.js', 'dashboard.js', 'charts.js', 'record.js', 'category-manager.js', 'categories.js', 'lib/dashboard-data.js', 'lib/insight-text.js', 'lib/viz.js', 'dom.js']) {
      const src = await (await get(api, `/js/${f}`)).text();
      expect(src, f).not.toMatch(/#b3261e|#0b6b3a|#ac3a31|#f59387|rgb\(179, ?38, ?30\)|rgb\(172, ?58, ?49\)|rgb\(11, ?107, ?58\)/i);
    }
  });

  test('C-C36 기록·대시보드(지출/수입)·관리 화면 전수 검사: computed color/fill/background 에 --danger/--ok 없음(오류 문구·삭제 버튼 제외)', async ({ browser }, testInfo) => {
    test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요 (R4/R5 항목이 있는 화면에서 검사)');
    const api = await newApi();
    expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#record');
    await expect(page.locator('#insights .insight-overspending')).toBeVisible();
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    expect(await scanColors(page), '기록 탭').toEqual([]);
    // 유형 토글 수입, 수정 모드
    await page.locator('#type-income').click();
    expect(await scanColors(page), '기록 탭(수입)').toEqual([]);
    await page.locator('#type-expense').click();
    await page.locator('#tx-list .tx-edit').first().click();
    expect(await scanColors(page), '기록 탭(수정 모드)').toEqual([]);
    await page.locator('#cancel-edit-btn').click();
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await expect(page.locator('#chart-monthly svg.chart-svg')).toBeVisible();
    expect(await scanColors(page), '대시보드(지출)').toEqual([]);
    await page.locator('#chart-donut details summary').click();
    expect(await scanColors(page), '대시보드(표 펼침)').toEqual([]);
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut')).toHaveAttribute('aria-label', '카테고리 수입 비중'); // 시드 사용자는 이번 달 수입이 없어 빈 상태일 수 있다
    expect(await scanColors(page), '대시보드(수입)').toEqual([]);
    await page.goto('/#categories');
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    expect(await scanColors(page), '관리 화면').toEqual([]);
    await page.locator('#catm-income').click();
    expect(await scanColors(page), '관리 화면(수입)').toEqual([]);
    await ctx.close();
  });

  test('C-C36 오류 문구는 빨강을 계속 쓴다(--danger 허용 범위 확인) / 관리 화면 오류 상태도 나머지는 중립', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    await page.locator('#catm-name').fill('식비');
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-add-error')).toHaveText(/./);
    expect(await page.locator('#catm-add-error').evaluate((e) => getComputedStyle(e).color)).toBe(DANGER);
    expect(await scanColors(page)).toEqual([]);
    await ctx.close();
  });
});

// ============================================================ C-C37 D3 / 팔레트 대비
test.describe('C-C37 D3 막대와 팔레트 대비', () => {
  test('C-C37 수입·지출 막대 fill 이 모두 url(#...) 무늬이며 서로 다른 패턴, 범례 "수입 (/ 무늬)" "지출 (\\ 무늬)", 무늬 방향 반대', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      hash: '#dashboard',
      prepare: async (a) => { await addTx(a, { type: 'income', category: '급여', amount: 900000, date: '2026-10-02' }); await addTx(a, { category: '식비', amount: 400000, date: '2026-10-03' }); },
    });
    await expect(page.locator('#chart-monthly svg.chart-svg')).toBeVisible();
    const fills = await page.locator('#chart-monthly svg.chart-svg > rect').evaluateAll((rs) => [...new Set(rs.map((r) => r.getAttribute('fill')))]);
    expect(fills).toHaveLength(2);
    expect(fills.every((f) => /^url\(#.+\)$/.test(f))).toBe(true);
    expect(new Set(fills).size).toBe(2);
    const defs = await page.locator('#chart-monthly svg.chart-svg').evaluate((svg, fs) => fs.map((f) => svg.querySelector(`pattern[id="${f.slice(5, -1)}"]`).innerHTML.replace(/\s+/g, ' ')), fills);
    expect(defs[0]).not.toBe(defs[1]);
    const legendText = await page.locator('#chart-monthly .legend').innerText();
    expect(legendText).toContain('수입 (/ 무늬)');
    expect(legendText).toContain('지출 (\\ 무늬)');
    const items = await page.locator('#chart-monthly .legend li .legend-label').allTextContents();
    expect(items).toEqual(['수입 (/ 무늬)', '지출 (\\ 무늬)']); // 수입 -> 지출 순
    await ctx.close();
  });

  test('C-C37 팔레트 전 색(tokens.css --viz-1..8 라이트·다크 + 묶음 색)이 카드 배경 대비 3:1 이상, 서로 겹치지 않음 (수식 계산)', async () => {
    const api = await newApi();
    const css = await (await get(api, '/css/tokens.css')).text();
    // 라이트 = 최상위 :root 블록, 다크 = @media (prefers-color-scheme: dark) 안의 :root:not([data-theme="light"]) 블록
    const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
    const darkEnd = css.indexOf('}', css.indexOf('--viz-8', darkStart));
    const light = css.slice(0, darkStart);
    const dark = css.slice(darkStart, darkEnd);
    const pick = (blk, name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(blk)[1];
    const pal = (blk) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => pick(blk, `--viz-${n}`));
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const lightBg = pick(light, '--color-surface');
    const darkBg = pick(dark, '--color-surface');
    expect(lightBg.toLowerCase()).toBe('#ffffff');
    expect(darkBg.toLowerCase()).toBe('#1f1e1b');
    const lp = pal(light);
    const dp = pal(dark);
    const rl = lp.map((h) => `${h}=${contrast(h, lightBg).toFixed(2)}`);
    const rd = dp.map((h) => `${h}=${contrast(h, darkBg).toFixed(2)}`);
    for (const h of lp) expect(contrast(h, lightBg), rl.join(' ')).toBeGreaterThanOrEqual(3);
    for (const h of dp) expect(contrast(h, darkBg), rd.join(' ')).toBeGreaterThanOrEqual(3);
    expect(new Set(lp.map((x) => x.toLowerCase())).size).toBe(8);
    expect(new Set(dp.map((x) => x.toLowerCase())).size).toBe(8);
    // "그 외 N개" 묶음 색 = --color-text-muted (viz-other): 팔레트와 겹치지 않고 4.5:1 이상
    const mutedL = pick(light, '--color-text-muted');
    const mutedD = pick(dark, '--color-text-muted');
    expect(contrast(mutedL, lightBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mutedD, darkBg)).toBeGreaterThanOrEqual(4.5);
    expect(lp.map((x) => x.toLowerCase())).not.toContain(mutedL.toLowerCase());
    expect(dp.map((x) => x.toLowerCase())).not.toContain(mutedD.toLowerCase());
  });
});

// ============================================================ C-C38 문구
test.describe('C-C38 중립 문구', () => {
  test('C-C38 시드 사용자 기록 탭·대시보드에 "과소비/더 썼어요/덜 썼어요/초과" 없음, R4 가 "평소보다 많은 지출" 섹션에 "…보다 N% 많아요"', async ({ browser }, testInfo) => {
    test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요');
    const api = await newApi();
    expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#record');
    await expect(page.locator('#insights .insight-overspending')).toBeVisible();
    const banned = ['과소비', '더 썼어요', '덜 썼어요', '초과', '페이스 주의', '⚠'];
    const recordText = await page.locator('body').innerText();
    for (const w of banned) expect(recordText, `기록 탭 "${w}"`).not.toContain(w);
    await expect(page.locator('#insights .insight-overspending h3, #insights .insight-overspending h2').first()).toHaveText('평소보다 많은 지출');
    const lines = await page.locator('#insights .insight-overspending .insight').allTextContents();
    const exceeded = lines.filter((l) => l.includes('평소보다 많음'));
    expect(exceeded.length).toBeGreaterThan(0);
    for (const l of exceeded) expect(l).toMatch(/평소 월 평균 [\d,]+원보다 \d+% 많아요/);
    expect(lines.some((l) => l.includes('지금 속도'))).toBe(true);
    // 아이콘은 장식(aria-hidden)
    expect(await page.locator('#insights .insight-icon:not([aria-hidden="true"])').count()).toBe(0);
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    await expect(page.locator('#kpi .kpi')).toHaveCount(3);
    const dashText = await page.locator('body').innerText();
    for (const w of banned) expect(dashText, `대시보드 "${w}"`).not.toContain(w);
    await page.locator('#catview-income').click();
    await expect(page.locator('#chart-donut')).toHaveAttribute('aria-label', '카테고리 수입 비중'); // 시드 사용자는 이번 달 수입이 없어 빈 상태일 수 있다
    for (const w of banned) expect(await page.locator('body').innerText(), `대시보드(수입) "${w}"`).not.toContain(w);
    await page.goto('/#categories');
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    for (const w of banned) expect(await page.locator('body').innerText(), `관리 화면 "${w}"`).not.toContain(w);
    await ctx.close();
  });
});

// ============================================================ 연동 유지 (이름 변경 -> 화면)
test.describe('이름 변경·R1/R2 연동 UI', () => {
  test('이름 변경 후 기록 목록·요약·대시보드 범례·표·빠른 입력 칩에 새 이름, 옛 이름 0건 (새로고침 없이 / 후)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      prepare: async (a) => {
        for (const d of ['2026-10-15', '2026-10-16', '2026-10-17']) await addTx(a, { category: '카페/간식', memo: '라떼', amount: 4500, date: d });
        await addTx(a, { category: '카페/간식', memo: '라떼', amount: 4500, date: '2026-09-10' });
      },
    });
    await waitChips(page, 8);
    await expect(page.locator('#quick-chips button')).toHaveCount(1);
    await expect(page.locator('#quick-chips button')).toHaveAttribute('aria-label', /라떼 카페\/간식 4,500원 채우기/);
    await goManager(page);
    await expect(rowByName(page, '카페/간식').locator('.cat-used')).toHaveText('기록 4건');
    await rowByName(page, '카페/간식').getByRole('button', { name: '카페/간식 이름 바꾸기' }).click();
    await expect(page.locator('.cat-rename ~ .hint')).toHaveText('지난 기록 4건도 새 이름으로 바뀌어요.');
    await page.locator('.cat-rename input').fill('커피');
    await page.locator('.cat-rename input').press('Enter');
    await expect(page.locator('#catm-status')).toContainText('카페/간식 → 커피');
    await goRecord(page);
    await expect(page.locator('#tx-list')).toContainText('커피');
    await expect(page.locator('#tx-list')).not.toContainText('카페/간식');
    await expect(page.locator('#month-summary')).toContainText('커피');
    await expect(page.locator('#month-summary')).not.toContainText('카페/간식');
    await expect(page.locator('#quick-chips button')).toHaveAttribute('aria-label', /라떼 커피 4,500원 채우기/);
    expect(await chipNames(page)).toContain('커피');
    expect(await chipNames(page)).not.toContain('카페/간식');
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut .legend-label').first()).toHaveText('커피');
    await page.locator('#chart-donut details summary').click();
    await expect(page.locator('#chart-donut table')).not.toContainText('카페/간식');
    await expect(page.locator('#cat-trend-chips')).toContainText('커피');
    await page.reload();
    await expect(page.locator('#chart-donut .legend-label').first()).toHaveText('커피');
    await ctx.close();
  });

  test('C-C20(UI) 자동완성 제안에 category null 이면 카테고리를 채우지 않는다 (금액/메모만)', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, {
      prepare: async (a) => {
        for (const d of ['2026-10-14', '2026-10-15', '2026-10-16']) await addTx(a, { category: '식비', memo: '조의금', amount: 50000, date: d });
        await setActive(a, 'expense', '식비', false);
      },
    });
    await waitChips(page, 7);
    await page.locator('#memo').fill('조의');
    const sug = page.locator('#memo-suggestions button');
    await expect(sug).toHaveCount(1);
    await expect(sug).toHaveText('조의금 · 50,000원'); // 카테고리 이름 없음
    await sug.click();
    await expect(page.locator('#memo')).toHaveValue('조의금');
    await expect(page.locator('#amount')).toHaveValue('50,000');
    await expect(page.locator('#category-chips button[aria-pressed="true"]')).toHaveCount(0);
    // 저장 시도 -> 카테고리 선택 안내
    await page.locator('#save-btn').click();
    await expect(page.locator('#category-error')).toHaveText(/./);
    // 빠른 입력 칩에는 비활성 카테고리 그룹이 없다
    await expect(page.locator('#quick-section')).toBeHidden();
    await ctx.close();
  });

  test('카테고리 로드 실패: 칩 자리에 오류 문구 + [다시 시도], 복구 후 칩 표시', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('cuiF');
    const { ctx, page } = await newUiPage(browser, testInfo, { api: u.api });
    let fail = true;
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() === 'GET' && fail) await route.fulfill({ status: 500, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '서버에 문제가 생겼어요.' } }) });
      else await route.continue();
    });
    await page.goto('/#record');
    const retry = page.locator('#category-chips').getByRole('button', { name: '다시 시도' });
    await expect(retry).toBeVisible();
    await expect(page.locator('#category-chips .error-text')).toHaveText(/./);
    expect(await page.locator('#category-chips button.chip').count()).toBe(0);
    // 저장은 카테고리가 없어 막힌다 (요청을 보내지 않음)
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
    await page.locator('#amount').fill('1000');
    await page.locator('#save-btn').click();
    expect(posts).toHaveLength(0);
    fail = false;
    await retry.click();
    await expect(page.locator('#category-chips button.chip')).toHaveCount(8);
    // 관리 화면도 같은 실패 상태 처리
    await ctx.close();
  });

  test('관리 화면 직접 진입(#categories) 시 로드 전 "불러오는 중", 로드 실패 시 [다시 시도]', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('cuiM');
    const { ctx, page } = await newUiPage(browser, testInfo, { api: u.api });
    let fail = true;
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() === 'GET' && fail) await route.fulfill({ status: 500, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '서버에 문제가 생겼어요.' } }) });
      else await route.continue();
    });
    await page.goto('/#categories');
    await expect(page.locator('#catm-load-error-text')).toHaveText(/./);
    await expect(page.locator('#catm-add')).toBeHidden(); // 목록 없이 추가 폼을 보이지 않는다
    fail = false;
    await page.locator('#catm-retry').click();
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(8);
    await expect(page.locator('#catm-load-error')).toBeHidden();
    await ctx.close();
  });

  test('접근성: 관리 화면 입력 label, 토글 aria-pressed, 모든 행 버튼 접근 이름에 카테고리명, 아이콘만 버튼 없음', async ({ browser }, testInfo) => {
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('#panel-categories input')].filter((i) => !(i.labels && i.labels.length) && !i.getAttribute('aria-label')).map((i) => i.id));
    expect(unlabeled).toEqual([]);
    expect(await page.locator('#panel-categories select').count()).toBe(0);
    const names = await page.locator('#catm-active .cat-row').evaluateAll((rows) => rows.map((r) => ({
      name: r.querySelector('.cat-name').textContent, labels: [...r.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    })));
    for (const r of names) expect(r.labels).toEqual([`${r.name} 이름 바꾸기`, `${r.name} 사용 안 함`]);
    // h1 은 1개, 목록 제목 h2, 상태 영역 role=status
    expect(await page.locator('#panel-categories h1').count()).toBe(1);
    await expect(page.locator('#catm-status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#catm-segment, #panel-categories .segmented').first()).toHaveAttribute('role', 'group');
    // 사용 중 개수는 텍스트로도 알려 준다
    await expect(page.locator('#catm-list-title')).toHaveText('사용 중인 지출 카테고리 8/30');
    await ctx.close();
  });

  test('다른 사용자 격리(UI): B 의 화면에는 A 의 사용자 카테고리가 없다', async ({ browser }, testInfo) => {
    const A = await createLoggedInUser('isoA');
    await mkCat(A.api, 'expense', '에이전용');
    const { page, ctx } = await openApp(browser, testInfo, { hash: '#categories' });
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    expect(await activeNames(page)).not.toContain('에이전용');
    await ctx.close();
  });
});

// 시드 사용자 회귀: 관리 화면 진입 시에도 NaN/undefined 없음
test('시드 사용자 관리 화면: NaN/undefined 없음, 가로 스크롤 없음', async ({ browser }, testInfo) => {
  test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요');
  const api = await newApi();
  expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
  const { ctx, page } = await newUiPage(browser, testInfo, { api });
  await page.goto('/#categories');
  await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
  await expectNoBadNumbers(page);
  await expectNoHorizontalScroll(page, widthOf(testInfo));
  await ctx.close();
});
