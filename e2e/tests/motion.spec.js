// docs/plan-motion.md Q-M2: 모션 완료 기준 C-M1~C-M15. 이 파일만 움직임을 켠다('no-preference'). 나머지 e2e 는 reducedMotion 'reduce'.
// 시간·이징은 animationstart 때 getAnimations() 의 effect 에서 읽는다(waitForTimeout 으로 시간을 재지 않는다).
// 레이아웃 밀림은 "시작 상태에서 얼려 둔 화면"과 "끝 상태"의 레이아웃을 비교해 확인한다.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, json } from '../helpers/api.js';
import { newUiPage } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const onlyMobile = (testInfo) => test.skip(widthOf(testInfo) !== 360, '정적 항목은 mobile-360 에서만');
const OUT = 'cubic-bezier(0.2, 0, 0, 1)';
const IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
const CARDS = ['kpi', 'chart-donut', 'chart-monthly', 'chart-cat-trend', 'insights'];

const expense = (api, category, amount, date, memo = '') => addTx(api, { category, amount, date, memo });
const income = (api, category, amount, date, memo = '') => addTx(api, { type: 'income', category, amount, date, memo });
const mkCat = async (api, type, name) => { expect((await json(api, 'POST', '/api/categories', { type, name })).status()).toBe(201); };

async function richData(api) {
  for (const n of ['아홉째', '열째', '열한째']) await mkCat(api, 'expense', n);
  const all = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', '아홉째', '열째', '열한째'];
  for (const m of ['2026-08', '2026-09', '2026-10']) for (const [i, c] of all.entries()) await expense(api, c, 90_000 - i * 6_000, `${m}-0${(i % 8) + 1}`);
  for (const m of ['2026-08', '2026-09', '2026-10']) { await income(api, '급여', 2_500_000, `${m}-02`); await income(api, '용돈', 100_000, `${m}-03`); }
}

const INIT = () => {
  window.__anims = []; window.__freeze = false; window.__cls = 0; window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* 무시 */ }
  document.addEventListener('animationstart', (e) => {
    const t = e.target;
    const a = (t.getAnimations ? t.getAnimations() : []).find((x) => x.animationName === e.animationName);
    if (!a) return;
    const tm = a.effect.getTiming(); const ct = a.effect.getComputedTiming();
    const props = [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))];
    const kf0 = a.effect.getKeyframes()[0];
    const r = t.getBoundingClientRect();
    window.__anims.push({
      kfEasing: a.effect.getKeyframes()[0].easing,
      name: e.animationName, id: t.id || '', cls: typeof t.className === 'string' ? t.className : '', tag: t.tagName,
      cont: t.closest ? ((t.closest('#kpi,#chart-donut,#chart-monthly,#chart-cat-trend,#insights') || {}).id || '') : '',
      panel: t.closest ? ((t.closest('section[id^=panel-]') || {}).id || '') : '',
      duration: tm.duration, delay: tm.delay, easing: tm.easing, fill: tm.fill, end: ct.endTime, props, kfOpacity: kf0.opacity, kfTranslate: kf0.translate, kfTransform: kf0.transform,
      cx: r.left + r.width / 2, vw: document.documentElement.clientWidth, text: (t.textContent || '').trim().slice(0, 20),
    });
    if (window.__freeze) { a.pause(); a.currentTime = 0; }
  }, true);
};

async function open(browser, testInfo, { scheme = 'light', hash = '#record', prepare, user, motion = 'no-preference', freeze = false } = {}) {
  const u = user || await createLoggedInUser('mo');
  if (prepare) await prepare(u.api);
  const ui = await newUiPage(browser, testInfo, { api: u.api, reducedMotion: motion });
  const { page } = ui;
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.addInitScript(INIT);
  if (freeze) await page.addInitScript(() => { window.__freeze = true; });
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toBeVisible();
  return { ...u, ...ui, problems };
}
const anims = (page) => page.evaluate(() => window.__anims.slice());
const reset = (page) => page.evaluate(() => { window.__anims.length = 0; });
const goHash = async (page, h) => { await page.evaluate((x) => { location.hash = x; }, h); };
/** 진행 중인 모든 애니메이션이 끝나고 네트워크가 잠잠해질 때까지 */
const settle = async (page) => {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 });
  await page.waitForTimeout(50);
};
const unfreeze = (page) => page.evaluate(() => { window.__freeze = false; document.getAnimations().forEach((a) => a.finish()); });
const byName = (list, name) => list.filter((a) => a.name === name);

// ====================================================================== 공통
test.describe('C-M1~C-M2, C-M6 공통값·규칙', () => {
  test('C-M1 모션 변수 값, 새 애니메이션의 시간·이징이 변수에서 옴, tokens/components 변경 0', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: richData });
    const { page } = a;
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const g = (n) => cs.getPropertyValue(n).replace(/\s+/g, ' ').trim();
      return Object.fromEntries(['--motion-short', '--motion-base', '--motion-stagger', '--motion-stagger-total', '--motion-distance', '--ease-out', '--ease-in-out', '--ease-in'].map((n) => [n, g(n)]));
    });
    expect(v).toEqual({ '--motion-short': '150ms', '--motion-base': '220ms', '--motion-stagger': '30ms', '--motion-stagger-total': '300ms', '--motion-distance': '8px', '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)', '--ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)', '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)' });
    // 계산된 값 대조: 실제 재생된 애니메이션의 시간·이징
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    await settle(page);
    await reset(page);
    await page.locator('#dash-prev').click();
    await page.waitForFunction(() => window.__anims.length > 3);
    await page.waitForTimeout(300);
    const list = await anims(page);
    for (const x of list) {
      if (x.name === 'mb-fade-in') { expect(x.duration, `${x.cont} 페이드 시간`).toBe(220); expect(x.kfEasing).toBe(OUT); }
      if (x.name === 'mb-grow-x') { expect(x.duration).toBe(150); expect(x.kfEasing).toBe(IN_OUT); }
    }
    expect(list.length).toBeGreaterThan(0);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
    onlyMobile(testInfo);
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    expect(git('status', '--porcelain', '--untracked-files=no', '--', 'src/frontend/public/css/tokens.css', 'src/frontend/public/css/components.css').trim()).toBe('');
  });

  test('C-M2 keyframes 는 opacity·translate·transform 뿐, fill-mode backwards 뿐, 끝나면 getAnimations 비고 opacity 1·translate none', async ({ browser }, testInfo) => {
    const css = readFileSync(join(PUBLIC, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)].map((m) => ({ name: m[1], body: m[2] }));
    const mine = blocks.filter((b) => b.name.startsWith('mb-'));
    expect(mine.map((b) => b.name).sort()).toEqual(['mb-fade-in', 'mb-grow-x', 'mb-slide-in']);
    for (const b of mine) {
      const props = [...b.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['opacity', 'translate', 'transform'], `${b.name} 속성 ${p}`).toContain(p);
      expect(b.body, `${b.name} 은 from 만`).not.toMatch(/\bto\s*\{|100%/);
    }
    expect(css).not.toMatch(/animation[^;{}]*\b(both|forwards)\b/);
    expect(css).not.toMatch(/animation[^;{}]*!important/);
    // 끝난 뒤 상태
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: richData });
    const { page } = a;
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    await settle(page);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const st = await page.evaluate(() => ['#kpi > *', '#chart-donut > *', '#chart-monthly > *', '#insights > *', '.legend-bar__fill', '#panel-dashboard'].map((s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return { s, op: c.opacity, tr: c.translate, tf: c.transform }; }));
    for (const x of st) { expect(x.op, x.s).toBe('1'); expect(x.tr, x.s).toBe('none'); expect(x.tf, x.s).toBe('none'); }
    await a.ctx.close();
  });

  test('C-M6 JS 에 animate(·animationend·transitionend 없음, 인라인 style·<style>·인라인 script 없음, CSP 위반 0, 단위 정적 검사', async ({ browser }, testInfo) => {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(PUBLIC, 'js')).filter((p) => p.endsWith('.js'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\.animate\s*\(|animationend|transitionend/);
    }
    for (const f of ['index.html', 'login.html']) {
      const html = readFileSync(join(PUBLIC, f), 'utf8');
      expect(html, f).not.toMatch(/\sstyle\s*=|<style[\s>]|<script(?![^>]*\bsrc=)[^>]*>/i);
    }
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: richData });
    await expect(a.page.locator('#chart-donut .legend li').first()).toBeVisible();
    for (const h of ['#record', '#account', '#categories', '#dashboard']) { await goHash(a.page, h); await a.page.waitForTimeout(150); }
    await a.page.locator('#dash-prev').click();
    await settle(a.page);
    expect(await a.page.evaluate(() => window.__csp)).toEqual([]);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 페이드: 패널·카드
test.describe('C-M7~C-M8 페이드', () => {
  for (const scheme of ['light', 'dark']) {
    test(`C-M7 [${scheme}] 패널 전환마다 mb-fade-in 150ms ease-out 한 번(opacity 만), 첫 화면 로드는 재생 안 됨, 패널에 transform·translate 없음`, async ({ browser }, testInfo) => {
      const a = await open(browser, testInfo, { scheme, hash: '#record' });
      const { page } = a;
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      await page.waitForTimeout(300);
      const first = await anims(page);
      expect(first.filter((x) => x.panel && x.cls === '' && x.id.startsWith('panel-')), '첫 화면 로드: 패널 페이드 없음').toEqual([]);
      expect(await page.evaluate(() => document.documentElement.hasAttribute('data-motion-ready'))).toBe(true);
      for (const [hash, id] of [['#dashboard', 'panel-dashboard'], ['#account', 'panel-account'], ['#categories', 'panel-categories'], ['#record', 'panel-record'], ['#dashboard', 'panel-dashboard']]) {
        await reset(page);
        await goHash(page, hash);
        await expect(page.locator(`#${id}`)).toBeVisible();
        await page.waitForTimeout(50);
        const l = (await anims(page)).filter((x) => x.id === id && x.name === 'mb-fade-in');
        expect(l, `${hash} 패널 페이드 1회`).toHaveLength(1);
        expect(l[0]).toMatchObject({ duration: 150, delay: 0, kfEasing: OUT, fill: 'backwards', props: ['opacity'], kfOpacity: '0' });
        const cs = await page.locator(`#${id}`).evaluate((e) => { const c = getComputedStyle(e); return { tf: c.transform, tr: c.translate }; });
        expect(cs).toEqual({ tf: 'none', tr: 'none' });
        await settle(page);
      }
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    });
  }

  test('C-M8 카드 페이드는 5.3 표와 같다: 달 변경·탭 진입=5개, 6/12개월=월별·추이, 지출/수입=카테고리·추이, 카테고리 변경·추이 칩=없음, 220ms', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const a = await open(browser, testInfo, { hash: '#record', prepare: richData });
    const { page } = a;
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    const fadeCards = async (act) => {
      await settle(page);
      await reset(page);
      await act();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      const l = (await anims(page)).filter((x) => x.name === 'mb-fade-in' && CARDS.includes(x.cont));
      for (const x of l) { expect(x.duration, `${x.cont} 시간`).toBe(220); expect(x.kfEasing).toBe(OUT); expect(x.props).toEqual(['opacity']); }
      return [...new Set(l.map((x) => x.cont))].sort();
    };
    const ALL = [...CARDS].sort();
    expect(await fadeCards(async () => { await goHash(page, '#dashboard'); await expect(page.locator('#chart-donut .legend li').first()).toBeVisible(); }), '탭 진입').toEqual(ALL);
    expect(await fadeCards(async () => { await page.locator('#dash-prev').click(); await expect(page.locator('#dash-month')).toHaveText('2026년 9월'); }), '달 변경').toEqual(ALL);
    expect(await fadeCards(async () => { await page.locator('#range-12').click(); }), '6->12개월').toEqual(['chart-cat-trend', 'chart-monthly']);
    expect(await fadeCards(async () => { await page.locator('#catview-income').click(); await expect(page.locator('#donut-title')).toHaveText('카테고리별 수입'); }), '지출->수입').toEqual(['chart-cat-trend', 'chart-donut']);
    expect(await fadeCards(async () => { await page.locator('#catview-expense').click(); await expect(page.locator('#donut-title')).toHaveText('카테고리별 지출'); }), '수입->지출').toEqual(['chart-cat-trend', 'chart-donut']);
    expect(await fadeCards(async () => { await page.evaluate(() => document.dispatchEvent(new CustomEvent('categorieschanged'))); }), '카테고리 목록 변경').toEqual([]);
    expect(await fadeCards(async () => { await page.locator('#cat-trend-chips button').nth(1).click(); }), '추이 칩 선택').toEqual([]);
    expect(await fadeCards(async () => { await page.locator('#range-6').click(); }), '12->6개월').toEqual(['chart-cat-trend', 'chart-monthly']);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 슬라이드: 토스트·더 보기·재사용
test.describe('C-M9~C-M11 슬라이드', () => {
  for (const scheme of ['light', 'dark']) {
    test(`C-M9 [${scheme}] 토스트: 저장 영역 안과 탭바 위에서 translate 0 8px -> 0, opacity 0 -> 1, 220ms ease-out, 가로 가운데 유지, 글자만 바뀌거나 자리를 옮길 때는 재생 안 됨`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      const a = await open(browser, testInfo, { scheme });
      const { page } = a;
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      await page.locator('#category-chips button', { hasText: '식비' }).click();
      await page.locator('#amount').fill('3000');
      await reset(page);
      await page.locator('#save-btn').click();
      await expect(page.locator('#flash-undo')).toBeVisible();
      await page.waitForTimeout(60);
      const t1 = byName(await anims(page), 'mb-slide-in').filter((x) => x.id === 'toast');
      expect(t1, '저장 영역 안 토스트 슬라이드 1회').toHaveLength(1);
      expect(t1[0]).toMatchObject({ duration: 220, delay: 0, kfEasing: OUT, fill: 'backwards', kfOpacity: '0', kfTranslate: '0px 8px' });
      expect(t1[0].props.sort()).toEqual(['opacity', 'translate']);
      await settle(page);
      // 탭 이동으로 자리를 옮겨도 다시 재생하지 않는다
      await reset(page);
      await goHash(page, '#dashboard');
      await page.waitForTimeout(150);
      expect(byName(await anims(page), 'mb-slide-in').filter((x) => x.id === 'toast'), '자리 이동 시 재생 안 됨').toEqual([]);
      // 글자만 바뀌어도(되돌렸어요) 재생 안 됨: 기록으로 돌아와 되돌리기
      await goHash(page, '#record');
      await reset(page);
      if (await page.locator('#flash-undo').isVisible()) {
        await page.locator('#flash-undo').click();
        await expect(page.locator('#flash')).toHaveText('되돌렸어요');
        await page.waitForTimeout(100);
        expect(byName(await anims(page), 'mb-slide-in').filter((x) => x.id === 'toast'), '글자만 바뀔 때 재생 안 됨').toEqual([]);
      }
      // 대시보드에서 새로 나타나는 토스트(탭바 위 fixed): 가운데 유지
      await page.mouse.move(2, 2);
      await expect(page.locator('#flash')).toHaveText('', { timeout: 9000 });
      await goHash(page, '#dashboard');
      await expect(page.locator('#panel-dashboard')).toBeVisible();
      await settle(page);
      await reset(page);
      await page.evaluate(() => { document.getElementById('flash').textContent = '확인 토스트'; });
      await page.waitForTimeout(60);
      const t2 = byName(await anims(page), 'mb-slide-in').filter((x) => x.id === 'toast');
      expect(t2).toHaveLength(1);
      expect(t2[0]).toMatchObject({ duration: 220, kfEasing: OUT, kfTranslate: '0px 8px', kfOpacity: '0' });
      expect(Math.abs(t2[0].cx - t2[0].vw / 2), `탭바 위 토스트 가운데 ${t2[0].cx} vs ${t2[0].vw / 2}`).toBeLessThanOrEqual(1);
      await settle(page);
      const after = await page.locator('#toast').evaluate((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { op: c.opacity, tr: c.translate, tf: c.transform, cx: r.left + r.width / 2, vw: document.documentElement.clientWidth }; });
      expect(after.op).toBe('1');
      expect(after.tr).toBe('none');
      expect(Math.abs(after.cx - after.vw / 2)).toBeLessThanOrEqual(1);
      expect(a.problems).toEqual([]);
      await a.ctx.close();
    });
  }

  test('C-M10 "더 보기"를 누르면 새로 드러난 칸(8번째~, 접기 포함)만 슬라이드 인, 칩 선택·자동 펼침·접기 때는 0개', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { prepare: async (api) => {
      await mkCat(api, 'expense', '아홉째');
      for (const d of ['2026-10-02', '2026-10-09', '2026-10-16']) await expense(api, '아홉째', 5500, d, '아홉메모');
    } });
    const { page } = a;
    await expect(page.locator('#category-chips .chip--toggle')).toHaveText('더 보기 (2)');
    await page.waitForTimeout(200);
    await settle(page);
    await reset(page);
    await page.locator('#category-chips .chip--toggle').click();
    await expect(page.locator('#category-chips .chip--toggle')).toHaveText('접기');
    await page.waitForTimeout(60);
    const rev = byName(await anims(page), 'mb-slide-in').filter((x) => x.cls.includes('chip--reveal'));
    expect(rev.map((x) => x.text), '새로 드러난 칸(기타, 아홉째, 접기)').toEqual(['기타', '아홉째', '접기']);
    for (const x of rev) expect(x).toMatchObject({ duration: 220, kfEasing: OUT, fill: 'backwards', kfTranslate: '0px 8px', kfOpacity: '0' });
    await settle(page);
    // 칩 선택
    await reset(page);
    await page.locator('#category-chips button', { hasText: '교통' }).click();
    await page.waitForTimeout(150);
    expect((await anims(page)).filter((x) => x.name === 'mb-slide-in'), '칩 선택').toEqual([]);
    // 접기
    await page.locator('#category-chips .chip--toggle').click();
    await page.waitForTimeout(150);
    expect((await anims(page)).filter((x) => x.name === 'mb-slide-in'), '접기').toEqual([]);
    // 자동 펼침(빠른 입력으로 숨은 카테고리 선택)
    await page.locator('#quick-chips button', { hasText: '아홉메모' }).first().click();
    await expect(page.locator('#category-chips button', { hasText: '아홉째' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(150);
    expect((await anims(page)).filter((x) => x.name === 'mb-slide-in'), '자동 펼침').toEqual([]);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-M11 재사용: mb-slide-in 에 --motion-distance 100% 를 준 임시 요소가 자기 높이만큼 아래에서 올라온다 (제품 코드 추가 없음)', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo);
    const { page } = a;
    const r = await page.evaluate(async () => {
      const d = document.createElement('div');
      d.className = 'chip--reveal';
      d.style.setProperty('--motion-distance', '100%');
      d.style.height = '200px'; d.style.width = '100px'; d.style.position = 'fixed'; d.style.left = '10px'; d.style.top = '100px';
      document.body.appendChild(d);
      const an = d.getAnimations()[0];
      an.pause(); an.currentTime = 0;
      const kf = an.effect.getKeyframes()[0];
      const start = getComputedStyle(d).translate;
      const r0 = d.getBoundingClientRect().top;
      an.finish();
      const end = getComputedStyle(d).translate;
      const r1 = d.getBoundingClientRect().top;
      d.remove();
      return { name: an.animationName, kf: kf.translate, start, end, shift: r0 - r1 };
    });
    expect(r.name).toBe('mb-slide-in');
    expect(r.kf).toBe('0px 100%');
    expect(r.start).toMatch(/200px|100%/);
    expect(r.end).toBe('none');
    expect(Math.round(r.shift), '시작 위치가 끝 위치보다 높이(200px)만큼 아래').toBe(200);
    await a.ctx.close();
  });
});

// ====================================================================== 스태거
test.describe('C-M12~C-M13 막대 스태거', () => {
  test('C-M12 달 변경·탭 진입·지출/수입 전환: 막대마다 mb-grow-x, i번째 지연 min(i*30,150), 길이 150, 마지막 endTime 300 이하 (8행·"그 외"·1행·수입 보기)', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const a = await open(browser, testInfo, { hash: '#record', prepare: richData });
    const { page } = a;
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    const grow = async (act, rows) => {
      await settle(page); await reset(page);
      await act();
      await expect(page.locator('#chart-donut .legend li')).toHaveCount(rows);
      await page.waitForFunction(() => window.__anims.filter((x) => x.name === 'mb-grow-x').length >= 1);
      await page.waitForTimeout(450);
      const l = byName(await anims(page), 'mb-grow-x');
      expect(l, `막대 ${rows}개`).toHaveLength(rows);
      l.forEach((x, i) => {
        expect(x.duration).toBe(150);
        expect(x.kfEasing).toBe(IN_OUT);
        expect(x.fill).toBe('backwards');
        expect(x.props).toEqual(['transform']);
        expect(x.delay, `${i}번째 지연`).toBe(Math.min(i * 30, 150));
        expect(x.end, `${i}번째 끝`).toBeLessThanOrEqual(300);
      });
      expect(Math.max(...l.map((x) => x.end))).toBeLessThanOrEqual(300);
      return l;
    };
    const tab = await grow(async () => { await goHash(page, '#dashboard'); }, 8); // 11개 카테고리: 7 + 그 외
    expect(tab.map((x) => x.delay)).toEqual([0, 30, 60, 90, 120, 150, 150, 150]);
    expect(Math.max(...tab.map((x) => x.end))).toBe(300);
    await grow(async () => { await page.locator('#dash-prev').click(); }, 8);
    await grow(async () => { await page.locator('#catview-income').click(); }, 2);
    await grow(async () => { await page.locator('#catview-expense').click(); }, 8);
    // 막대 너비(끝 상태): 최대 금액 = 100%
    await settle(page);
    const widths = await page.locator('#chart-donut .legend-bar__fill').evaluateAll((els) => els.map((e) => ({ w: e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width, tf: getComputedStyle(e).transform })));
    expect(Math.max(...widths.map((x) => x.w))).toBeGreaterThan(0.98);
    expect(widths.every((x) => x.tf === 'none')).toBe(true);
    // 1행
    const u = await createLoggedInUser('mo1');
    await expense(u.api, '식비', 10000, '2026-10-05');
    const b = await open(browser, testInfo, { hash: '#record', user: u });
    await expect(b.page.locator('#category-chips button').first()).toBeVisible();
    await goHash(b.page, '#dashboard');
    await expect(b.page.locator('#chart-donut .legend li')).toHaveCount(1);
    await b.page.waitForTimeout(450);
    const one = byName(await anims(b.page), 'mb-grow-x');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ delay: 0, duration: 150, end: 150 });
    expect(a.problems.concat(b.problems)).toEqual([]);
    await a.ctx.close(); await b.ctx.close();
  });

  test('C-M13 6/12개월 전환·카테고리 목록 변경 때는 막대 애니메이션 0개', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: richData });
    const { page } = a;
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    await settle(page);
    await reset(page);
    await page.locator('#range-12').click();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
    await page.waitForTimeout(450);
    expect(byName(await anims(page), 'mb-grow-x'), '6->12개월').toEqual([]);
    await settle(page); await reset(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('categorieschanged')));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(450);
    expect(byName(await anims(page), 'mb-grow-x'), '카테고리 목록 변경').toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 레이아웃·입력·줄이기
test.describe('C-M3~C-M5 레이아웃 밀림·입력·줄이기', () => {
  /** 화면 안 요소의 레이아웃(transform 에 영향 받지 않는 offset* 값) */
  /** 크기만 비교(translate 가 걸린 요소의 offsetParent 가 바뀌어 offsetLeft/Top 은 움직임과 상관없이 달라진다) */
  const sizes = (page, root) => page.evaluate((sel) => [...document.querySelectorAll(`${sel}, ${sel} *`)].filter((e) => !(e instanceof SVGElement)).map((e) => [e.tagName + (e.id ? `#${e.id}` : ''), e.offsetWidth, e.offsetHeight].join(':')), root);
  const layout = (page, root) => page.evaluate((sel) => [...document.querySelectorAll(`${sel}, ${sel} *`)].filter((e) => !(e instanceof SVGElement)).map((e) => [e.tagName + (e.id ? `#${e.id}` : ''), e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(':')), root);

  test('C-M3 레이아웃 밀림 0: 얼린 시작 상태와 끝 상태의 레이아웃이 같고, 움직임 때문에 CLS 가 늘지 않는다', async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const a = await open(browser, testInfo, { hash: '#record', prepare: richData, freeze: true });
    const { page } = a;
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    // (1) 패널 전환(기록 -> 대시보드)
    await goHash(page, '#dashboard');
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const frozen = await page.evaluate(() => document.getAnimations().length);
    expect(frozen, '얼린 애니메이션이 있다').toBeGreaterThan(3);
    const before = await layout(page, '#panel-dashboard');
    const topsBefore = await page.evaluate(() => [...document.querySelectorAll('#panel-dashboard .card')].map((c) => Math.round(c.getBoundingClientRect().top)));
    await unfreeze(page);
    await settle(page);
    const after = await layout(page, '#panel-dashboard');
    const topsAfter = await page.evaluate(() => [...document.querySelectorAll('#panel-dashboard .card')].map((c) => Math.round(c.getBoundingClientRect().top)));
    expect(after, '대시보드 레이아웃(카드·막대·버튼) 시작 = 끝').toEqual(before);
    expect(topsAfter).toEqual(topsBefore);
    // (2) 토스트
    await goHash(page, '#record');
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    await page.evaluate(() => { window.__freeze = true; });
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await page.locator('#amount').fill('3000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash-undo')).toBeVisible();
    await page.waitForTimeout(100);
    const dockBefore = await sizes(page, '#save-dock');
    const formBefore = await page.evaluate(() => [...document.querySelectorAll('#tx-form > *')].map((e) => Math.round(e.getBoundingClientRect().top)));
    await unfreeze(page);
    await settle(page);
    expect(await sizes(page, '#save-dock'), '저장 도크 레이아웃(크기)').toEqual(dockBefore);
    expect(await page.evaluate(() => [...document.querySelectorAll('#tx-form > *')].map((e) => Math.round(e.getBoundingClientRect().top)))).toEqual(formBefore);
    // (3) 더 보기: 펼침 자체 이동을 뺀 비교 = 새 칸이 그려진 직후(얼림)와 끝
    await page.mouse.move(2, 2);
    await expect(page.locator('#flash')).toHaveText('', { timeout: 9000 });
    await page.evaluate(() => { window.__freeze = true; });
    await page.locator('#category-chips .chip--toggle').click();
    await page.waitForTimeout(100);
    const gridBefore = await sizes(page, '#category-chips');
    const belowBefore = await page.evaluate(() => Math.round(document.querySelector('#memo').getBoundingClientRect().top));
    await unfreeze(page);
    await settle(page);
    expect(await sizes(page, '#category-chips'), '격자 레이아웃(크기)').toEqual(gridBefore);
    expect(await page.evaluate(() => Math.round(document.querySelector('#memo').getBoundingClientRect().top))).toBe(belowBefore);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
    // CLS: 데이터를 새로 받는 장면은 로딩 때문에 값이 크게 흔들려(실행마다 0.1~0.8) 움직임과 상관없는 값이 섞인다.
    // 그래서 (1) 데이터가 바뀌지 않는 패널 왕복에서 움직임이 켜진 상태의 CLS 합이 0 인지, (2) 같은 시험을 움직임 줄이기와 비교해 차이가 없는지 본다.
    const hop = async (motion) => {
      const c = await open(browser, testInfo, { hash: '#record', user: a, motion });
      await expect(c.page.locator('#category-chips button').first()).toBeVisible();
      await expect(c.page.locator('#tx-list .tx-row').first()).toBeVisible();
      await settle(c.page);
      const out = [];
      for (const h of ['#account', '#record', '#account', '#record']) {
        await c.page.evaluate(() => { window.__cls = 0; });
        await goHash(c.page, h);
        await c.page.waitForTimeout(400);
        await c.page.waitForLoadState('networkidle');
        out.push(Number((await c.page.evaluate(() => window.__cls)).toFixed(4)));
      }
      await c.ctx.close();
      return out;
    };
    const on = await hop('no-preference');
    const off = await hop('reduce');
    console.log('C-M3 CLS 패널 왕복(기록<->내 정보) no-preference=' + JSON.stringify(on) + ' reduce=' + JSON.stringify(off));
    expect(Math.max(...on), '움직임이 켜진 패널 전환의 CLS').toBeLessThanOrEqual(0.001);
    expect(Math.max(...on) - Math.max(...off)).toBeLessThanOrEqual(0.001);
  });

  test('C-M4 움직이는 도중(얼린 시작 상태)에도 클릭·Tab·Enter 가 동작: 탭 전환 직후 저장 버튼, 토스트 [되돌리기], 펼친 직후 8번째 카테고리, 달 변경 직후 표로 보기', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => { await richData(api); }, freeze: true });
    const { page } = a;
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    // 달 변경 직후 "표로 보기"
    await page.locator('#dash-prev').click();
    await page.waitForTimeout(60);
    expect(await page.evaluate(() => document.getAnimations().length), '움직이는 중').toBeGreaterThan(0);
    const op = await page.locator('#chart-donut > *').first().evaluate((e) => getComputedStyle(e).opacity);
    expect(Number(op)).toBeLessThan(0.5);
    await page.locator('#chart-donut details summary').click();
    await expect(page.locator('#chart-donut table')).toBeVisible();
    // 탭 전환 직후 저장 버튼 (패널이 투명한 동안)
    await goHash(page, '#record');
    await page.waitForTimeout(40);
    expect(await page.evaluate(() => document.getAnimations().some((x) => x.animationName === 'mb-fade-in'))).toBe(true);
    await page.locator('#save-btn').click({ force: true });
    await expect(page.locator('#amount-error')).not.toHaveText('');
    // Tab·Enter: 금액 칸에서 Tab 으로 첫 빠른 금액 버튼, Enter 로 금액 입력
    await page.locator('#amount').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#amount')).not.toHaveValue('');
    // 더 보기 직후 8번째 카테고리 Enter 로 선택
    await page.locator('#category-chips .chip--toggle').click();
    await page.waitForTimeout(40);
    expect(await page.evaluate(() => document.getAnimations().some((x) => x.animationName === 'mb-slide-in'))).toBe(true);
    expect(await page.evaluate(() => document.activeElement.textContent), '펼친 뒤 포커스는 8번째 카테고리').toBe('기타');
    await page.keyboard.press('Enter');
    await expect(page.locator('#category-chips button', { hasText: '기타' })).toHaveAttribute('aria-pressed', 'true');
    // 저장 -> 토스트 슬라이드 중 [되돌리기]
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash-undo')).toBeVisible();
    await page.waitForTimeout(40);
    expect(await page.evaluate(() => document.getAnimations().some((x) => x.animationName === 'mb-slide-in' && x.effect.target.id === 'toast'))).toBe(true);
    await page.locator('#flash-undo').click();
    await expect(page.locator('#flash')).toHaveText('되돌렸어요');
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('C-M5 움직임 줄이기: 모든 장면에서 애니메이션 0개이고 끝 상태(opacity 1, translate none)가 같다', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const a = await open(browser, testInfo, { hash: '#record', prepare: async (api) => { await richData(api); }, motion: 'reduce' });
    const { page } = a;
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    const count = () => page.evaluate(() => ({ now: document.getAnimations().length, started: window.__anims.length }));
    const check = async (label) => { await page.waitForTimeout(350); const c = await count(); expect(c, label).toEqual({ now: 0, started: 0 }); };
    await goHash(page, '#dashboard'); await expect(page.locator('#chart-donut .legend li').first()).toBeVisible(); await check('탭 진입');
    await page.locator('#dash-prev').click(); await check('달 변경');
    await page.locator('#range-12').click(); await check('기간');
    await page.locator('#catview-income').click(); await check('수입 보기');
    await goHash(page, '#account'); await check('내 정보');
    await goHash(page, '#categories'); await check('카테고리 관리');
    await goHash(page, '#record'); await expect(page.locator('#category-chips button').first()).toBeVisible();
    await page.locator('#category-chips .chip--toggle').click(); await check('더 보기');
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await page.locator('#amount').fill('2000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash-undo')).toBeVisible(); await check('토스트');
    // 끝 상태
    const st = await page.evaluate(() => ['#toast', '#panel-record', '.legend-bar__fill'].map((s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return { s, op: c.opacity, tr: c.translate }; }).filter(Boolean));
    for (const x of st) { expect(x.op, x.s).toBe('1'); expect(x.tr, x.s).toBe('none'); }
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 범위
test.describe('C-M14~C-M15 회귀·범위', () => {
  test('C-M15 변경 범위: backend·schema·api.md·tokens·components 변경 없음, 변경 파일은 허용 폴더 안', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    expect(git('status', '--porcelain', '--untracked-files=no', '--', 'src/backend', 'docs/api.md', 'src/frontend/public/css/tokens.css', 'src/frontend/public/css/components.css', 'src/frontend/office').trim()).toBe('');
    const changed = git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
    const allowed = /^(src\/frontend\/public\/|src\/frontend\/test\/|e2e\/|docs\/|design_handoff_moneybook\/)/;
    expect(changed.filter((f) => !allowed.test(f)), '허용 폴더 밖 변경').toEqual([]);
  });
});
