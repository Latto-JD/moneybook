// 후속 2단계 재검증 2: 휴대폰 피드백 4건(토스트 겹침, 저장 버튼 sticky, 헤더 이름 글자, 아이콘 전용 화면 모드 버튼).
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { createLoggedInUser, addTx } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';

const widthOf = (testInfo) => testInfo.project.use.viewport.width;

async function open(browser, testInfo, { scheme = 'light', height, prepare } = {}) {
  const u = await createLoggedInUser('s2b');
  if (prepare) await prepare(u.api);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  if (height) await page.setViewportSize({ width: widthOf(testInfo), height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.goto('/#record');
  await expect(page.locator('#user-name')).toHaveText(u.account.name);
  await expect(page.locator('#category-chips button').first()).toBeVisible();
  return { ...ui, ...u, problems };
}
const rect = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);

test.describe('재검증 2 저장 버튼 sticky', () => {
  for (const scheme of ['light', 'dark']) {
    test(`[${scheme}] 360x800(768x1024) 첫 화면에서 #save-btn 이 보이고 탭바와 겹치지 않음, 폼 요소가 저장 버튼에 가려지지 않음`, async ({ browser }, testInfo) => {
      const w = widthOf(testInfo);
      const a = await open(browser, testInfo, { scheme, height: w === 360 ? 800 : 1024 });
      const { page } = a;
      const vh = page.viewportSize().height;
      const sv = await rect(page, '#save-btn');
      const tb = await rect(page, '.tabbar');
      expect(sv.t, `저장 버튼이 첫 화면 안 ${JSON.stringify(sv)}`).toBeGreaterThanOrEqual(0);
      expect(sv.b, '탭바 위').toBeLessThanOrEqual(tb.t + 0.5);
      expect(tb.b).toBeLessThanOrEqual(vh + 0.5);
      expect(sv.h).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: join(testInfo.outputDir, `save-first-${scheme}-${w}.png`) });
      // 스크롤해도 고정 위치 유지, 탭바와 겹치지 않음
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      const sv2 = await rect(page, '#save-btn');
      const tb2 = await rect(page, '.tabbar');
      expect(sv2.b, '맨 아래에서도 탭바 위').toBeLessThanOrEqual(tb2.t + 0.5);
      expect(sv2.t).toBeGreaterThanOrEqual(0);
      // 각 입력 요소를 스크롤로 불러왔을 때 저장 버튼이 그 위를 덮지 않는다(중심점 hit-test)
      const targets = ['#amount', '.quick-amounts button', '#category-chips button', '#memo', '#date-details summary', '#type-expense'];
      for (const sel of targets) {
        await page.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(100);
        const hit = await page.evaluate((s) => {
          const e = document.querySelector(s);
          const r = e.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { ok: !!el && (e === el || e.contains(el) || el.contains(e)) && !el.closest('#save-btn'), covered: el && (el.id || el.className), top: r.top, bottom: r.bottom };
        }, sel);
        expect(hit.ok, `${sel} 가 가려짐 ${JSON.stringify(hit)}`).toBe(true);
      }
      // 메모에 포커스(키보드)해도 저장 버튼 뒤로 숨지 않음
      await page.locator('#memo').focus();
      const mr = await rect(page, '#memo');
      const sr = await rect(page, '#save-btn');
      expect(mr.b <= sr.t + 0.5 || mr.t >= sr.b - 0.5, `메모 ${JSON.stringify(mr)} 가 저장 ${JSON.stringify(sr)} 와 겹침`).toBe(true);
      await page.screenshot({ path: join(testInfo.outputDir, `save-memo-${scheme}-${w}.png`) });
      await expectNoHorizontalScroll(page, w);
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    });
  }

  test('저장 버튼이 목록·인사이트 같은 아래쪽 내용을 가리지 않음(문서 끝까지 스크롤), 수정 모드에서도 유지', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo, {
      height: w === 360 ? 800 : 1024,
      prepare: async (api) => { for (let i = 1; i <= 12; i++) await addTx(api, { amount: 1000 * i, category: '식비', memo: `행${i}`, date: '2026-10-1' + (i % 9) }); },
    });
    const { page } = a;
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const last = page.locator('#tx-list .tx-row').last();
    await last.scrollIntoViewIfNeeded();
    const r = await last.evaluate((e) => { const b = e.getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { t: b.top, b: b.bottom, covered: !!el.closest('#save-btn') }; });
    expect(r.covered, '목록 마지막 행이 저장 버튼에 덮임').toBe(false);
    const tb = await rect(page, '.tabbar');
    expect(r.b, '마지막 행이 탭바 아래로 숨지 않음').toBeLessThanOrEqual(tb.t + 1);
    // 수정 모드: 저장 버튼은 여전히 보이고 수정 취소가 닿는다
    await page.locator('#tx-list .tx-edit').first().click();
    await expect(page.locator('#cancel-edit-btn')).toBeVisible();
    await page.locator('#cancel-edit-btn').scrollIntoViewIfNeeded();
    const hit = await page.evaluate(() => { const b = document.querySelector('#cancel-edit-btn').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el && (el.id === 'cancel-edit-btn' || !!el.closest('#cancel-edit-btn')); });
    expect(hit, '수정 취소 버튼이 저장 버튼에 가려짐').toBe(true);
    await page.screenshot({ path: join(testInfo.outputDir, `save-edit-${w}.png`) });
    await a.ctx.close();
  });
});

test.describe('재검증 2 토스트·헤더', () => {
  test('토스트: 글자와 [되돌리기] 박스 겹침 0, 토스트 안에 들어감', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo);
    const { page } = a;
    await page.locator('#category-chips button', { hasText: '식비' }).first().click();
    await page.locator('#amount').fill('3000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash-undo')).toBeVisible();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    const m = await page.evaluate(() => {
      const f = document.querySelector('#flash'); const rg = document.createRange(); rg.selectNodeContents(f);
      const tx = rg.getBoundingClientRect(); const u = document.querySelector('#flash-undo').getBoundingClientRect();
      const fb = f.getBoundingClientRect(); const t = document.querySelector('#toast').getBoundingClientRect();
      const ov = (p, q) => Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left)) * Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top));
      return { textVsBtn: ov(tx, u), boxVsBtn: ov(fb, u), gap: u.left - tx.right, inside: u.left >= t.left && u.right <= t.right && tx.left >= t.left, undoH: u.height, vw: document.documentElement.clientWidth, tl: t.left, tr: t.right };
    });
    expect(m.textVsBtn, JSON.stringify(m)).toBe(0);
    expect(m.boxVsBtn, JSON.stringify(m)).toBe(0);
    expect(m.gap).toBeGreaterThan(4);
    expect(m.inside).toBe(true);
    expect(m.undoH).toBeGreaterThanOrEqual(44);
    expect(m.tl).toBeGreaterThanOrEqual(0);
    expect(m.tr).toBeLessThanOrEqual(m.vw + 0.5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(testInfo.outputDir, `toast-${w}.png`), clip: { x: 0, y: 0, width: w, height: 160 } });
    await a.ctx.close();
  });

  test('헤더: 이름 글자(--fs-body-lg·600·--color-text), 모드 버튼은 44px 원형 아이콘만(글자 시각적으로 숨김, 접근 이름 유지), 한 줄', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    for (const [scheme, stored] of [['light', null], ['dark', null], ['light', 'dark'], ['dark', 'light']]) {
      const a = await open(browser, testInfo, { scheme });
      const { page } = a;
      if (stored) { await page.evaluate((v) => localStorage.setItem('mb-theme', v), stored); await page.reload(); await expect(page.locator('#user-name')).toBeVisible(); }
      const mode = await page.locator('#theme-toggle').getAttribute('data-mode');
      expect(mode).toBe(stored || scheme);
      const m = await page.evaluate(() => {
        const cs = (s) => getComputedStyle(document.querySelector(s));
        const probe = (v) => { const i = document.createElement('i'); i.style.fontSize = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).fontSize; i.remove(); return x; };
        const colorOf = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).color; i.remove(); return x; };
        const t = document.querySelector('#theme-toggle'); const tr = t.getBoundingClientRect();
        const ic = cs('#theme-toggle .icon'); const tx = document.querySelector('#theme-toggle .theme-toggle__text'); const txr = tx.getBoundingClientRect();
        const n = document.querySelector('#user-name').getBoundingClientRect(); const o = document.querySelector('#theme-toggle').getBoundingClientRect(); // 로그아웃은 내 정보 화면으로 옮겨졌다
        return {
          nameFs: cs('#user-name').fontSize, bodyLg: probe('--fs-body-lg'), nameFw: cs('#user-name').fontWeight, nameColor: cs('#user-name').color, textColor: colorOf('--color-text'),
          w: tr.width, h: tr.height, radius: cs('#theme-toggle').borderTopLeftRadius, bgImg: ic.backgroundImage, mask: ic.maskImage || ic.webkitMaskImage, iconW: ic.width, iconBg: ic.backgroundColor,
          textVisible: txr.width > 2 || txr.height > 2, label: t.getAttribute('aria-label'), text: tx.textContent,
          tMid: (tr.top + tr.bottom) / 2, nMid: (n.top + n.bottom) / 2, oMid: (o.top + o.bottom) / 2, nameR: n.right, toggleL: tr.left, toggleR: tr.right, outL: o.left, outR: o.right, vw: document.documentElement.clientWidth,
          headH: document.querySelector('.app-header').getBoundingClientRect().height,
        };
      });
      const tag = `${scheme}/${stored}`;
      expect(m.nameFs, tag).toBe(m.bodyLg);
      expect(m.nameFw, tag).toBe('600');
      expect(m.nameColor, tag).toBe(m.textColor);
      expect(Math.round(m.w), tag).toBe(44);
      expect(Math.round(m.h), tag).toBe(44);
      expect(m.radius, tag).toMatch(/50%|22px|9999|\d{2,}px/);
      expect(m.bgImg, `${tag} 색 있는 아이콘은 배경 그림`).toContain(`theme-${mode}.svg`);
      expect(m.mask, tag).toMatch(/none|^$/);
      expect(m.textVisible, `${tag} 글자는 시각적으로 숨김`).toBe(false);
      expect(m.text).toBe(mode === 'light' ? '라이트' : '다크');
      expect(m.label).toBe(mode === 'light' ? '화면 모드: 라이트. 누르면 다크로 바뀌어요' : '화면 모드: 다크. 누르면 라이트로 바뀌어요');
      await expect(page.getByRole('button', { name: /화면 모드/ })).toHaveCount(1);
      expect(Math.abs(m.tMid - m.nMid), tag).toBeLessThan(6);
      expect(Math.abs(m.tMid - m.oMid), tag).toBeLessThan(6);
      expect(m.nameR, `${tag} 이름/토글 겹침`).toBeLessThanOrEqual(m.toggleL + 0.5);
      expect(m.outR).toBeLessThanOrEqual(m.vw + 0.5);
      expect(m.headH, `${tag} 헤더 한 줄`).toBeLessThan(80);
      await page.screenshot({ path: join(testInfo.outputDir, `header-${scheme}-${stored}-${w}.png`), clip: { x: 0, y: 0, width: w, height: 80 } });
      // 누르면 전환되고 접근 이름·글자가 갱신, 포커스 유지
      await page.locator('#theme-toggle').click();
      const other = mode === 'light' ? 'dark' : 'light';
      await expect(page.locator('#theme-toggle')).toHaveAttribute('data-mode', other);
      expect(await page.locator('#theme-toggle .icon').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(`theme-${other}.svg`);
      await expect(page.locator('#theme-status')).toHaveText(other === 'dark' ? '다크 모드' : '라이트 모드');
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    }
  });
});

test.describe('재검증 3 저장 버튼 포커스', () => {
  test('Tab 으로 #save-btn 에 가도 페이지가 끝까지 튀지 않고 포커스 링이 보인다(라이트), 메모 포커스 시 가려지지 않음', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo, { height: w === 360 ? 800 : 1024 });
    const { page } = a;
    await page.locator('#amount').fill('1000');
    await page.locator('#category-chips button').first().click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#memo').focus();
    const before = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Tab'); // 메모 -> (제안/날짜) ... 저장 버튼까지
    for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement.id)) !== 'save-btn'; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('save-btn');
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({ y: window.scrollY, max: document.documentElement.scrollHeight - innerHeight, shadow: getComputedStyle(document.activeElement).boxShadow, fv: document.activeElement.matches(':focus-visible'), focus: getComputedStyle(document.documentElement).getPropertyValue('--color-focus').trim() }));
    console.log(`SAVE-FOCUS ${w}px before=${before} y=${m.y} max=${m.max} shadow=${m.shadow.slice(0, 90)}`);
    expect(m.fv).toBe(true);
    expect(m.shadow, '포커스 링 box-shadow 에 --color-focus(라이트)').toContain('rgb(6, 88, 171)');
    expect(m.y - before, '저장 버튼 포커스로 페이지가 크게 튀지 않음').toBeLessThan(m.max - before - 20 > 0 ? 400 : 400);
    expect(m.y, '문서 끝까지 튀지 않음').toBeLessThan(Math.max(m.max - 20, 1));
    const b = await rect(page, '#save-btn'); const tb = await rect(page, '.tabbar');
    expect(b.b).toBeLessThanOrEqual(tb.t + 0.5);
    await page.screenshot({ path: join(testInfo.outputDir, `save-focus-${w}.png`) });
    // 메모 포커스: 가려지지 않음(360/768)
    await page.locator('#memo').focus();
    const mr = await rect(page, '#memo'); const sr = await rect(page, '#save-btn');
    expect(mr.b <= sr.t + 0.5 || mr.t >= sr.b - 0.5, `메모 ${JSON.stringify(mr)} 저장 ${JSON.stringify(sr)}`).toBe(true);
    await a.ctx.close();
  });
});
