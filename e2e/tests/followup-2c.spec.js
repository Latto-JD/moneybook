// 후속 2단계 재검증 4: 입력 초기화 아이콘 버튼, 다크 모드 금색 선.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(resolve(HERE, '..', '..'), 'src', 'frontend', 'public');
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const RESET = '#reset-btn';

async function open(browser, testInfo, { scheme = 'light', prepare, stored } = {}) {
  const u = await createLoggedInUser('s2c');
  if (prepare) await prepare(u.api);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.addInitScript((v) => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective)); if (v) localStorage.setItem('mb-theme', v); }, stored ?? null);
  await page.goto('/#record');
  await expect(page.locator('#user-name')).toHaveText(u.account.name);
  await expect(page.locator('#category-chips button').first()).toBeVisible();
  return { ...ui, ...u, problems };
}
const chip = (page, name) => page.locator('#category-chips button', { hasText: name }).first();
const activeId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);

test.describe('재검증 4 입력 초기화 버튼', () => {
  test('표시 조건: 처음엔 숨김, 카테고리만 골라도 숨김, 금액·메모·종류·날짜가 바뀌면 보임, 저장 직후(카테고리만 남음)·수정 모드에선 숨김', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { prepare: async (api) => { await addTx(api, { amount: 5000, category: '식비', memo: '기존', date: '2026-10-19' }); } });
    const { page } = a;
    await expect(page.locator(RESET)).toBeHidden();
    await chip(page, '교통').click();
    await expect(page.locator(RESET), '카테고리만 고름').toBeHidden();
    await page.locator('#amount').fill('1200');
    await expect(page.locator(RESET), '금액 입력').toBeVisible();
    await page.locator('#amount').fill('');
    await expect(page.locator(RESET), '금액 지움').toBeHidden();
    await page.locator('#memo').fill('메모');
    await expect(page.locator(RESET), '메모 입력').toBeVisible();
    await page.locator('#memo').fill('');
    await expect(page.locator(RESET)).toBeHidden();
    await page.locator('#type-income').click();
    await expect(page.locator(RESET), '종류 변경').toBeVisible();
    await page.locator('#type-expense').click();
    await expect(page.locator(RESET), '종류 되돌림').toBeHidden();
    await page.locator('#date-details summary').click();
    await page.locator('#date').fill('2026-10-10');
    await expect(page.locator(RESET), '날짜 변경').toBeVisible();
    await page.locator('#date').fill('2026-10-19');
    await expect(page.locator(RESET), '날짜 되돌림').toBeHidden();
    // 저장 직후: 카테고리는 남지만 숨김
    await chip(page, '교통').click();
    await page.locator('#amount').fill('3000');
    await expect(page.locator(RESET)).toBeVisible();
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#category-chips button[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator(RESET), '저장 직후').toBeHidden();
    // 수정 모드: 숨김(금액이 채워져 있어도)
    await page.locator('#tx-list .tx-edit', { hasText: '기존' }).click();
    await expect(page.locator('#amount')).not.toHaveValue('');
    await expect(page.locator(RESET), '수정 모드').toBeHidden();
    await page.locator('#cancel-edit-btn').click();
    await expect(page.locator(RESET), '수정 취소 후').toBeHidden();
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('동작: 금액·메모 비움 + 지출 + 카테고리 없음 + 오늘, 포커스 금액칸, 토스트 없음, 요청 없음, 이름·44px·키보드', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo);
    const { page } = a;
    const reqs = [];
    page.on('request', (r) => { if (r.method() !== 'GET') reqs.push(`${r.method()} ${r.url()}`); });
    await page.locator('#type-income').click();
    await chip(page, '급여').click();
    await page.locator('#amount').fill('777000');
    await page.locator('#memo').fill('월급');
    await page.locator('#date-details summary').click();
    await page.locator('#date').fill('2026-09-01');
    const btn = page.getByRole('button', { name: '입력 초기화' });
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // 같은 행(금액 라벨 줄) 오른쪽
    const row = await page.evaluate(() => { const b = document.querySelector('#reset-btn').getBoundingClientRect(); const l = document.querySelector('#amount').closest('.field').querySelector('label, .field__label, .field-head > *:not(#reset-btn)'); const lr = l.getBoundingClientRect(); return { bl: b.left, lr: lr.right, bt: b.top, lt: lr.top, lb: lr.bottom, bb: b.bottom, vw: document.documentElement.clientWidth, br: b.right }; });
    expect(row.bl, JSON.stringify(row)).toBeGreaterThanOrEqual(row.lr - 1);
    expect(row.br).toBeLessThanOrEqual(row.vw);
    expect(row.bt, '라벨과 같은 줄').toBeLessThan(row.lb);
    await page.screenshot({ path: join(testInfo.outputDir, `reset-visible-${widthOf(testInfo)}.png`), clip: { x: 0, y: 0, width: widthOf(testInfo), height: 800 } });
    await btn.click();
    await expect(page.locator('#amount')).toHaveValue('');
    await expect(page.locator('#memo')).toHaveValue('');
    await expect(page.locator('#type-expense')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#type-income')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#category-chips button[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('#date')).toHaveValue('2026-10-19');
    await expect(page.locator('#date-summary')).toHaveText('오늘');
    expect(await activeId(page), '포커스 금액칸').toBe('amount');
    await expect(page.locator('#flash')).toHaveText('');
    await expect(page.locator('#toast')).toBeHidden();
    await expect(page.locator(RESET)).toBeHidden();
    expect(reqs, '서버 요청 없음').toEqual([]);
    await expect(page.locator('#save-btn')).toHaveAttribute('aria-disabled', 'true');
    // 키보드(Enter, Space)
    for (const key of ['Enter', 'Space']) {
      await page.locator('#amount').fill('900');
      await expect(page.locator(RESET)).toBeVisible();
      await page.locator(RESET).focus();
      await page.keyboard.press(key);
      await expect(page.locator('#amount')).toHaveValue('');
      expect(await activeId(page), `${key} 뒤 포커스`).toBe('amount');
    }
    // Tab 순서에 들어 있다: 금액칸에서 Shift+Tab 으로 닿는 요소 중 하나가 초기화 버튼 (표시 중일 때)
    await page.locator('#amount').fill('1');
    await page.locator('#amount').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await activeId(page)).toBe('reset-btn');
    expect(await page.locator(RESET).evaluate((e) => e.matches(':focus-visible')), '키보드 포커스 링').toBe(true);
    await page.screenshot({ path: join(testInfo.outputDir, 'reset-focus-' + widthOf(testInfo) + '.png'), clip: { x: 0, y: 0, width: widthOf(testInfo), height: 500 } });
    // 수정 요청이 가지 않고 저장도 되지 않았다
    expect(reqs).toEqual([]);
    expect(a.problems).toEqual([]);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    await a.ctx.close();
  });

  test('접근성·모양: 라이트·다크 아이콘 윤곽 대비 3:1 이상, 아이콘 파일 외부 URL 없음', async ({ browser }, testInfo) => {
    const svg = readFileSync(join(PUBLIC, 'icons', 'reset.svg'), 'utf8');
    expect(svg).not.toMatch(/<metadata|c2pa|https?:\/\/(?!www\.w3\.org\/2000\/svg)|data:|<script|<image/i);
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme });
      const { page } = a;
      await page.locator('#amount').fill('1');
      await expect(page.locator(RESET)).toBeVisible();
      const m = await page.evaluate(() => {
        const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const b = document.querySelector('#reset-btn'); const ic = b.querySelector('.icon');
        const ics = getComputedStyle(ic);
        let bgEl = b; let bg = 'rgba(0, 0, 0, 0)';
        while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(bgEl).backgroundColor; bgEl = bgEl.parentElement; }
        const fg = ics.backgroundColor;
        const [x, y] = [lum(parse(fg)), lum(parse(bg))].sort((p, q) => q - p);
        return { fg, bg, ratio: (x + 0.05) / (y + 0.05), mask: ics.maskImage || ics.webkitMaskImage, img: ics.backgroundImage, w: ics.width };
      });
      expect(m.mask + m.img, JSON.stringify(m)).toMatch(/reset\.svg/);
      if (/reset\.svg/.test(m.mask)) expect(m.ratio, `${scheme} 아이콘 대비 ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: join(testInfo.outputDir, `reset-${scheme}-${widthOf(testInfo)}.png`), clip: { x: 0, y: 200, width: widthOf(testInfo), height: 300 } });
      expect(await page.evaluate(() => window.__csp)).toEqual([]);
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });
});

// ====================================================================== 다크 금색 선
test.describe('재검증 4 다크 금색 선, 라이트 불변', () => {
  const hex = (s) => { const n = parseInt(s.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (p, q) => { const [x, y] = [lum(p), lum(q)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  test('토큰 값: 다크 --color-line #4B4231, --color-border #9A7E4A, field-line, 두 다크 블록(OS 다크·data-theme=dark) 같음, 포커스 링 불변, 라이트 값 불변(git HEAD 대조)', async ({}, testInfo) => {
    test.skip(widthOf(testInfo) !== 360, '정적 검사는 mobile-360 에서만');
    const css = readFileSync(join(PUBLIC, 'css', 'tokens.css'), 'utf8').replace(/\r\n/g, '\n');
    const i = css.indexOf('@media (prefers-color-scheme: dark)');
    const lightBlock = css.slice(css.indexOf(':root {'), i);
    const darkBlock = css.slice(i);
    expect(darkBlock.match(/--color-line:\s*#4B4231/gi)?.length, '다크 블록 2곳').toBe(2);
    expect(darkBlock.match(/--color-border:\s*#9A7E4A/gi)?.length).toBe(2);
    expect(darkBlock.match(/--color-field-line:\s*#9A7E4A/gi)?.length).toBe(2);
    expect(darkBlock.match(/--color-field-line-active:\s*var\(--color-focus\)/gi)?.length, '다크 포커스 밑줄은 포커스 파랑').toBe(2);
    expect(lightBlock).not.toMatch(/4B4231|9A7E4A|C9A55C/i);
    expect(darkBlock.match(/--color-focus:\s*#7DB6FE/gi)?.length, '포커스 링 색 불변').toBeGreaterThanOrEqual(2);
    // 라이트 블록(:root {...} 시작~다크 미디어 직전)은 직전 커밋과 --color-* 값이 같다(신규 field-line 두 줄만 추가)
    const { execFileSync } = await import('node:child_process');
    const old = execFileSync('git', ['show', 'HEAD:src/frontend/public/css/tokens.css'], { cwd: resolve(HERE, '..', '..'), encoding: 'utf8' }).replace(/\r\n/g, '\n');
    const oldLight = old.slice(old.indexOf(':root {'), old.indexOf('@media (prefers-color-scheme: dark)'));
    const props = (b) => Object.fromEntries([...b.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const [pn, po] = [props(lightBlock), props(oldLight)];
    const diffs = Object.keys(po).filter((k) => pn[k] !== po[k]);
    expect(diffs, '라이트 토큰 변경').toEqual([]);
    expect(Object.keys(pn).filter((k) => !(k in po)).sort(), '라이트 신규 토큰').toEqual(['--color-field-line', '--color-field-line-active']);
    expect(pn['--color-field-line']).toBe('var(--color-line)');
  });

  test('대비: 다크 배경·카드 대 --color-border/--color-field-line 3:1 이상, 라이트 불변 값 확인', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { scheme: 'dark' });
    const { page } = a;
    const t = await page.evaluate(() => {
      const probe = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).color; i.remove(); return x; };
      return { border: probe('--color-border'), line: probe('--color-line'), field: probe('--color-field-line'), active: probe('--color-field-line-active'), bg: getComputedStyle(document.body).backgroundColor, surface: probe('--color-surface'), sunken: probe('--color-surface-sunken'), focus: probe('--color-focus') };
    });
    const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
    expect(t.border, JSON.stringify(t)).toBe('rgb(154, 126, 74)');
    expect(t.line).toBe('rgb(75, 66, 49)');
    expect(t.field).toBe('rgb(154, 126, 74)');
    expect(t.active, '입력 중 밑줄 = 포커스 파랑').toBe('rgb(125, 182, 254)');
    console.log('FIELD-LINE-CONTRAST idle->active ' + ratio(rgb(t.active), rgb(t.field)).toFixed(2) + ' active vs card ' + ratio(rgb(t.active), rgb(t.surface)).toFixed(2) + ' idle vs card ' + ratio(rgb(t.field), rgb(t.surface)).toFixed(2)); // 평상시 대비는 기록만(색상 계열이 금색->파랑으로 바뀜), 필수 기준은 카드 대비 3:1
    for (const base of ['bg', 'surface']) expect(ratio(rgb(t.border), rgb(t[base])), `border 대 ${base}`).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb(t.border), rgb(t.sunken)), 'border 대 눌린 면').toBeGreaterThanOrEqual(3);
    expect(ratio(rgb(t.active), rgb(t.surface)), '입력 중 밑줄').toBeGreaterThanOrEqual(3);
    expect(t.focus, '포커스 링 불변').toBe('rgb(125, 182, 254)');
    // 실제 화면 요소의 선 색: 입력 테두리, 칩 테두리, 금액 밑줄
    const el = await page.evaluate(() => (document.activeElement && document.activeElement.blur(), {
      memo: getComputedStyle(document.querySelector('#memo')).borderTopColor,
      chip: getComputedStyle(document.querySelector('#category-chips button')).borderTopColor,
      amountLine: getComputedStyle(document.querySelector('.amount-wrap')).borderBottomColor,
      amountLineActive: (() => { document.querySelector('#amount').focus(); return getComputedStyle(document.querySelector('.amount-wrap')).borderBottomColor; })(),
      text: getComputedStyle(document.body).color,
    }));
    console.log(`DARK-LINES ${JSON.stringify(el)}`);
    expect(el.memo, '메모 테두리가 금색').toBe('rgb(154, 126, 74)');
    expect(el.chip).toBe('rgb(154, 126, 74)');
    expect(el.amountLine, '금액 밑줄 금색').toBe('rgb(154, 126, 74)');
    expect(el.amountLineActive, '입력 중 밑줄').toBe('rgb(125, 182, 254)');
    expect(el.text, '글자색 불변').toBe('rgb(238, 235, 227)');
    await page.screenshot({ path: join(testInfo.outputDir, `dark-gold-${widthOf(testInfo)}.png`) });
    await a.ctx.close();
    // 라이트 값 불변(OS 라이트, 저장값 없음)
    const b = await open(browser, testInfo, { scheme: 'light' });
    const lt = await b.page.evaluate(() => {
      const probe = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).color; i.remove(); return x; };
      return { border: probe('--color-border'), line: probe('--color-line'), memo: getComputedStyle(document.querySelector('#memo')).borderTopColor };
    });
    console.log(`LIGHT-LINES ${JSON.stringify(lt)}`);
    expect(lt.border).not.toBe('rgb(154, 126, 74)');
    expect(lt.line).not.toBe('rgb(75, 66, 49)');
    await b.page.screenshot({ path: join(testInfo.outputDir, `light-${widthOf(testInfo)}.png`) });
    await b.ctx.close();
  });
});
