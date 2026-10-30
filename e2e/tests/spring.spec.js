// docs/plan-spring.md Q-S2: 스크롤 출렁임 완료 기준 C-S1~C-S18. 이 파일은 움직임을 켠다('no-preference').
// 관찰은 페이지 안 rAF 기록기(__startRec)가 프레임마다 유닛의 계산된 transform(ty, scaleY)을 모아 한다.
// 입력 중 끄기 기준은 구현 승인대로 "입력칸에서 마지막 input/keydown 뒤 800ms 이내"로 읽는다(포커스만 있으면 출렁인다).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, json } from '../helpers/api.js';
import { newUiPage } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const isTouch = (testInfo) => !!testInfo.project.use.hasTouch;
const onlyMobile = (testInfo) => test.skip(testInfo.project.use.viewport.width !== 360, '이 항목은 mobile-360 에서만');

const UNITS = '#month-totals, #quick-section, #tx-list .tx-date, #tx-list .tx-row, #kpi, .donut-card, .insights-card, .chart-card:has(> #chart-monthly), .chart-card:has(> #chart-cat-trend), #catm-active > .cat-row, #catm-inactive > .cat-row, .account-card';
const EXCL = '.app-header, .tabbar, #toast, #save-dock, #tx-form, #tx-form *, #account-form, #account-form *, #catm-add, #catm-add *, section[id^="panel-"], #main, body, html';

// ---------------------------------------------------------------- 데이터
const mkCat = async (api, type, name) => { expect((await json(api, 'POST', '/api/categories', { type, name })).status()).toBe(201); };
let shared = null;
async function sharedUser() {
  if (shared) return shared;
  const u = await createLoggedInUser('sp');
  for (const n of ['아홉째', '열째', '열한째', '열두째', '열셋째', '열넷째', '열다섯째', '열여섯째']) await mkCat(u.api, 'expense', n);
  const cats = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', '아홉째', '열째', '열한째'];
  for (let i = 0; i < 44; i++) {
    const res = await addTx(u.api, { category: cats[i % cats.length], amount: 10_000 + i * 100, date: `2026-10-${String((i % 19) + 1).padStart(2, '0')}`, memo: `행${i}` });
    expect(res.status()).toBe(201);
  }
  for (const m of ['2026-08', '2026-09', '2026-10']) for (const [i, c] of cats.entries()) await addTx(u.api, { category: c, amount: 90_000 - i * 6_000, date: `${m}-0${(i % 8) + 1}` });
  for (const m of ['2026-08', '2026-09', '2026-10']) { await addTx(u.api, { type: 'income', category: '급여', amount: 2_500_000, date: `${m}-02` }); await addTx(u.api, { type: 'income', category: '용돈', amount: 100_000, date: `${m}-03` }); }
  shared = u;
  return u;
}

// ---------------------------------------------------------------- 페이지 안 도구
const INIT = () => {
  window.__raf = { all: 0, spring: 0 };
  window.__rafOrig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => { window.__raf.all++; if (fn && fn.name === 'frame') window.__raf.spring++; return window.__rafOrig(fn); };
  window.__listeners = [];
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (this === window || this === document) window.__listeners.push({ type, passive: !!(opts && typeof opts === 'object' && opts.passive), stack: new Error().stack.includes('scroll-spring') });
    return add.call(this, type, fn, opts);
  };
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective));
  window.__longtasks = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 50) window.__longtasks++; }).observe({ type: 'longtask', buffered: true }); } catch { /* 무시 */ }
};

/** 프레임마다 유닛·제외 요소 상태를 모으는 기록기 */
const REC = ({ unitSel, exclSel }) => {
  const rec = { frames: [], stop: false, lastScroll: 0, lastWheel: 0 };
  window.__rec = rec;
  window.addEventListener('scroll', () => { rec.lastScroll = performance.now(); }, { passive: true });
  window.addEventListener('wheel', () => { rec.lastWheel = performance.now(); }, { passive: true });
  const parse = (s) => {
    if (!s || s === 'none') return [0, 1];
    const m3 = s.match(/matrix3d\((.*)\)/);
    if (m3) { const a = m3[1].split(',').map(Number); return [a[13], a[5]]; }
    const m = s.match(/matrix\((.*)\)/);
    if (m) { const a = m[1].split(',').map(Number); return [a[5], a[3]]; }
    return [NaN, NaN];
  };
  const dockSel = ['#save-dock', '#toast'];
  const loop = () => {
    if (rec.stop) return;
    const units = [...document.querySelectorAll(unitSel)];
    const ex = [...document.querySelectorAll(exclSel)];
    const hot = [...document.querySelectorAll('[style]')].filter((e) => e.style.transform || e.style.willChange);
    const f = {
      t: performance.now(),
      spring: document.documentElement.hasAttribute('data-spring'),
      sh: document.scrollingElement.scrollHeight,
      sy: window.scrollY,
      u: units.map((e) => { const cs = getComputedStyle(e); const [ty, s] = parse(cs.transform); const r = e.getBoundingClientRect(); return { ty, s, c: r.top + r.height / 2, row: e.matches('.tx-row, .tx-date, .cat-row'), will: e.style.willChange, inl: e.style.transform }; }),
      hot: hot.length,
      hotOutside: hot.filter((e) => !e.matches(unitSel)).map((e) => e.tagName + '#' + e.id + '.' + e.className),
      exBad: ex.filter((e) => e.style.transform || e.style.willChange).map((e) => e.tagName + '#' + e.id),
      exTf: ex.filter((e) => e.matches('#toast, #save-dock, #tx-form, #main, .tabbar, .app-header, body, html') || e.matches('section[id^="panel-"]')).map((e) => (e.id || e.className || e.tagName) + '=' + getComputedStyle(e).transform + '/' + getComputedStyle(e).translate).join('|'),
      dock: dockSel.map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { s, b: r.bottom, l: r.left, w: r.width, cx: r.left + r.width / 2 }; }),
      hit: (() => { const b = document.getElementById('save-btn'); if (!b || b.offsetParent === null) return null; const r = b.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; if (y < 0 || y > innerHeight) return null; const h = document.elementFromPoint(x, y); return !!(h && h.closest('#save-btn')); })(),
    };
    rec.frames.push(f);
    window.__rafOrig(loop);
  };
  window.__rafOrig(loop);
};

async function open(browser, testInfo, { scheme = 'light', hash = '#record', motion = 'no-preference', user, viewport, init } = {}) {
  const u = user || await sharedUser();
  const ui = await newUiPage(browser, testInfo, { api: u.api, reducedMotion: motion });
  const { page } = ui;
  if (viewport) await page.setViewportSize(viewport);
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.addInitScript(INIT);
  if (init) await page.addInitScript(init);
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toBeVisible();
  return { ...ui, problems, user: u };
}

const goHash = (page, h) => page.evaluate((x) => { location.hash = x; }, h);
const startRec = (page) => page.evaluate(REC, { unitSel: UNITS, exclSel: EXCL });
const frames = (page) => page.evaluate(() => window.__rec.frames);
const rafStats = (page) => page.evaluate(() => ({ ...window.__raf }));
const springRaf = (page) => page.evaluate(() => window.__raf.spring);
const springRunning = (page) => page.evaluate(() => document.documentElement.hasAttribute('data-spring'));
const maxScroll = (page) => page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);

/** 거래 목록이 화면 위쪽에 오도록 프로그램 스크롤(출렁임 없음) */
const toList = async (page) => {
  await page.evaluate(() => { const r = document.getElementById('tx-list').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 200); });
  await page.waitForTimeout(300);
};

/** 휠 한 번 이상. 마우스 위치가 기준점이 된다. */
async function wheel(page, x, y, dy, steps = 1, gap = 16) {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); if (gap) await page.waitForTimeout(gap); }
}
/** 터치 스크롤(CDP Input.dispatchTouchEvent). 손가락을 위로 밀어 down px 만큼 아래로 스크롤. 끝 속도가 빠르면 관성(플링)이 생긴다. */
async function touchScroll(page, x, y, down, { steps = 12, gap = 16 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (down * i) / steps }] });
    await page.waitForTimeout(gap);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
/** data-spring 이 사라지고 모든 유닛이 정지할 때까지. 마지막 스크롤 이벤트 이후 걸린 시간(ms)을 돌려준다. */
async function settleAfterScroll(page, timeout = 3000) {
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-spring'), null, { timeout, polling: 'raf' });
  const ms = await page.evaluate(() => performance.now() - window.__rec.lastScroll);
  return ms;
}
const maxAbs = (arr) => arr.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
const rowFrames = (fr) => fr.flatMap((f) => f.u.filter((x) => x.row));
const cardFrames = (fr) => fr.flatMap((f) => f.u.filter((x) => !x.row));

/** 모든 프레임 공통 검사: 제외 요소 무변화, 활성 40개 이하, 상한, 인라인 transform 은 유닛에만 */
function expectCommon(fr, label) {
  expect(fr.length, `${label} 프레임 수`).toBeGreaterThan(5);
  expect(fr.flatMap((f) => f.exBad), `${label} 제외 요소의 인라인 transform·will-change`).toEqual([]);
  expect(fr.flatMap((f) => f.hotOutside), `${label} 유닛 밖 인라인 transform`).toEqual([]);
  expect(Math.max(...fr.map((f) => f.hot)), `${label} 인라인 transform 요소 수`).toBeLessThanOrEqual(40);
  expect(maxAbs(rowFrames(fr).map((x) => x.ty)), `${label} 행 상한`).toBeLessThanOrEqual(12.5);
  expect(maxAbs(cardFrames(fr).map((x) => x.ty)), `${label} 카드 상한`).toBeLessThanOrEqual(20.5);
  expect(Math.max(...fr.flatMap((f) => f.u.map((x) => x.s))), `${label} scaleY`).toBeLessThanOrEqual(1.016);
  expect(fr.flatMap((f) => f.u).some((x) => Number.isNaN(x.ty)), `${label} 파싱 불가 transform`).toBe(false);
  const exSet = new Set(fr.map((f) => f.exTf));
  expect(exSet.size, `${label} 제외 요소의 계산된 transform 이 프레임마다 같다: ${[...exSet].join(' ## ').slice(0, 300)}`).toBe(1);
}

/** 변위 0: 계산된 transform 이 none 이거나 항등 행렬 (재검증: 유닛에 data-spring-unit 의 translate3d(0,0,0) 이 상시 걸림) */
const isIdentity = (tf) => {
  if (!tf || tf === 'none') return true;
  const m = tf.match(/^matrix(3d)?\((.*)\)$/);
  if (!m) return false;
  const v = m[2].split(',').map(Number);
  const id = m[1] ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 1, 0, 0];
  return v.length === id.length && v.every((x, i) => Math.abs(x - id[i]) < 1e-6);
};

// ====================================================================== 기록 탭 (거래 목록)
for (const scheme of ['light', 'dark']) {
  test(`C-S1~S5, S7 [${scheme}] 기록 탭 휠: 행이 독립적으로 출렁이고 상한·수렴·제외 요소·스크롤 높이 유지`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const a = await open(browser, testInfo, { scheme });
    const { page } = a;
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(await maxScroll(page), '스크롤 가능한 길이').toBeGreaterThan(900);
    const vw = page.viewportSize();
    const sh0 = await page.evaluate(() => document.scrollingElement.scrollHeight);
    await toList(page);
    await page.mouse.move(vw.width / 2, 500);
    await startRec(page);
    await page.waitForTimeout(100);
    // 600px 스크롤(한 번에) 후 수렴
    await wheel(page, vw.width / 2, 500, 600, 6, 16);
    const ms = await settleAfterScroll(page);
    const fr1 = await frames(page);
    console.log(`C-S1 [${scheme}] 600px: 프레임 ${fr1.length}, 유닛 ${fr1[5].u.length}(행 ${fr1[5].u.filter((x) => x.row).length}), 행 최대 ${maxAbs(rowFrames(fr1).map((x) => x.ty)).toFixed(2)}, 카드 최대 ${maxAbs(cardFrames(fr1).map((x) => x.ty)).toFixed(2)}, 스크롤 ${fr1[0].sy}->${fr1.at(-1).sy}, 활성 최대 ${Math.max(...fr1.map((f) => f.hot))}, data-spring 프레임 ${fr1.filter((f) => f.spring).length}`);
    expectCommon(fr1, '600px');
    expect(Math.max(...rowFrames(fr1).map((x) => Math.abs(x.ty))), 'C-S1 행 최대 |ty|').toBeGreaterThanOrEqual(6);
    // 같은 프레임에 서로 다른 두 유닛의 ty 차이 2px 이상
    expect(fr1.some((f) => { const t = f.u.map((x) => x.ty); return Math.max(...t) - Math.min(...t) >= 2; }), 'C-S1 독립 움직임').toBe(true);
    // C-S7 스크롤 높이
    expect(new Set(fr1.map((f) => f.sh)), 'C-S7 scrollHeight').toEqual(new Set([sh0]));
    // C-S4 수렴
    console.log(`C-S4 [${scheme}] 600px 휠 수렴 ${Math.round(ms)}ms, 최대 행 |ty| ${maxAbs(rowFrames(fr1).map((x) => x.ty)).toFixed(2)}, 최대 scaleY ${Math.max(...fr1.flatMap((f) => f.u.map((x) => x.s))).toFixed(4)}`);
    expect(ms, 'C-S4 마지막 스크롤 이벤트 뒤 수렴 시간').toBeLessThanOrEqual(1000);
    const end = await page.evaluate(() => [...document.querySelectorAll('#tx-list .tx-row, #tx-list .tx-date, #month-totals')].map((e) => ({ tf: getComputedStyle(e).transform, wc: e.style.willChange, inl: e.style.transform, org: e.style.transformOrigin })));
    expect(end.filter((x) => !isIdentity(x.tf) || x.wc !== '' || x.inl !== '' || x.org !== ''), 'C-S4 정지 뒤 변위 0(항등)·인라인 transform 없음·will-change 없음').toEqual([]);
    const r0 = (await rafStats(page)).spring;
    await page.waitForTimeout(500);
    expect((await rafStats(page)).spring - r0, 'C-S4 정지 뒤 스프링 rAF 예약').toBe(0);
    // C-S3 빠른 연속 휠 3000px
    await page.evaluate(() => { window.__rec.frames.length = 0; });
    const rec = await page.evaluate(() => 0);
    void rec;
    await wheel(page, vw.width / 2, 500, 3000, 10, 8);
    await settleAfterScroll(page);
    const fr2 = await page.evaluate(() => window.__rec.frames);
    expectCommon(fr2, '3000px 연속 휠');
    expect(Math.max(...fr2.map((f) => f.hot)), '3000px 도중 활성 유닛').toBeLessThanOrEqual(40);
    // 위로 스크롤도 대칭
    await page.evaluate(() => { window.__rec.frames.length = 0; });
    await wheel(page, vw.width / 2, 500, -800, 8, 16);
    await settleAfterScroll(page);
    const fr3 = await page.evaluate(() => window.__rec.frames);
    expectCommon(fr3, '위로 800px');
    expect(Math.min(...rowFrames(fr3).map((x) => x.ty)), '위로 스크롤하면 음의 변위가 나온다').toBeLessThan(-3);
    expect(a.problems).toEqual([]);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    await a.ctx.close();
  });
}

test('C-S2 끌림 규칙: 기준점에 가까운 행이 먼 행보다 덜 움직인다 (휠 100px 한 번)', async ({ browser }, testInfo) => {
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(400);
  const vw = page.viewportSize();
  await toList(page); // 프로그램 스크롤: 출렁임 없음
  await startRec(page);
  await page.waitForTimeout(100);
  const refY = 420;
  await wheel(page, vw.width / 2, refY, 100, 1, 0);
  await settleAfterScroll(page);
  const fr = await frames(page);
  // 주입이 일어난 첫 프레임들: 기준점까지 거리 순으로 정렬해 가까운 행/먼 행의 최대 |ty|
  const sample = fr.filter((f) => f.u.some((x) => Math.abs(x.ty) > 0.01)).slice(0, 3);
  expect(sample.length, '움직인 프레임 있음').toBeGreaterThan(0);
  const per = new Map();
  for (const f of sample) f.u.forEach((x, i) => { if (!x.row || x.c < -50 || x.c > 900) return; const d = Math.abs(x.c - refY); const p = per.get(i) || { d: 1e9, m: 0 }; p.d = Math.min(p.d, d); p.m = Math.max(p.m, Math.abs(x.ty)); per.set(i, p); });
  const list = [...per.values()].sort((p, q) => p.d - q.d);
  const near = list.slice(0, 2);
  const far = list.slice(-2);
  console.log('C-S2 가까운 행(d,|ty|)=' + JSON.stringify(near.map((p) => [Math.round(p.d), +p.m.toFixed(2)])) + ' 먼 행=' + JSON.stringify(far.map((p) => [Math.round(p.d), +p.m.toFixed(2)])));
  expect(Math.max(...near.map((p) => p.m)), 'C-S2 가장 가까운 행 < 가장 먼 행').toBeLessThan(Math.max(...far.map((p) => p.m)));
  await a.ctx.close();
});

// ====================================================================== 터치 (mobile-360)
test('C-S1, S3, S4 터치 스크롤(CDP 제스처, 플링 포함): 출렁이고 상한 안에서 수렴', async ({ browser }, testInfo) => {
  test.skip(!isTouch(testInfo), '터치는 mobile-360 에서만');
  test.setTimeout(90_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(400);
  await toList(page);
  await startRec(page);
  await page.waitForTimeout(100);
  await touchScroll(page, 180, 650, 600, { steps: 15, gap: 16 });
  const ms1 = await settleAfterScroll(page, 5000).catch(() => -1);
  const fr = await page.evaluate(() => window.__rec.frames);
  expectCommon(fr, '터치 600px');
  console.log(`터치 600px: 최대 행 |ty| ${maxAbs(rowFrames(fr).map((x) => x.ty)).toFixed(2)} 수렴 ${Math.round(ms1)}ms 스크롤 ${fr[0].sy}->${fr.at(-1).sy}`);
  expect(fr.at(-1).sy, '실제로 스크롤됨').toBeGreaterThan(300);
  expect(maxAbs(rowFrames(fr).map((x) => x.ty)), 'C-S1 터치 행 최대 |ty|').toBeGreaterThanOrEqual(6);
  expect(ms1, 'C-S4 터치 수렴').toBeGreaterThanOrEqual(0);
  expect(ms1).toBeLessThanOrEqual(1000 + 600); // 관성 구간이 있어 제스처 종료 뒤 시간. 관성 종료 기준은 별도 확인
  // 플링(빠른 속도)
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await touchScroll(page, 180, 700, 500, { steps: 5, gap: 8 });
  await settleAfterScroll(page, 6000).catch(() => {});
  const fr2 = await page.evaluate(() => window.__rec.frames);
  expectCommon(fr2, '터치 플링');
  console.log(`터치 플링: 최대 행 |ty| ${maxAbs(rowFrames(fr2).map((x) => x.ty)).toFixed(2)} 최대 카드 ${maxAbs(cardFrames(fr2).map((x) => x.ty)).toFixed(2)}`);
  expect(await springRunning(page), '플링 뒤 정지').toBe(false);
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

// ====================================================================== 저장 영역·토스트 고정 (C-S6)
test('C-S6 저장 영역(#save-dock)·토스트 위치 불변, 저장 버튼이 출렁이는 카드·행보다 위에 보인다', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.locator('#category-chips button', { hasText: '식비' }).click();
  await page.locator('#amount').fill('3000');
  await page.locator('#save-btn').click();
  await expect(page.locator('#flash-undo')).toBeVisible();
  await page.waitForTimeout(400);
  await page.mouse.move(2, 2); // 포인터가 토스트 위에 있으면 타이머가 멈춘다(반대로 치우면 5초 안에 끝나므로 서두른다)
  const vw = page.viewportSize();
  const scenario = async (label, prepare, wheelY, dy, needHit) => {
    await prepare();
    await page.waitForTimeout(300);
    const rest = await page.evaluate(() => ['#save-dock', '#toast'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { s, b: r.bottom, w: r.width, sy: scrollY }; }));
    await startRec(page);
    await page.waitForTimeout(100);
    await wheel(page, vw.width / 2, wheelY, dy, 3, 16);
    await settleAfterScroll(page);
    const fr = await page.evaluate(() => { window.__rec.stop = true; return window.__rec.frames; });
    expectCommon(fr, label);
    const moved = maxAbs(fr.flatMap((f) => f.u.map((x) => x.ty)));
    expect(moved, `${label}: 유닛은 실제로 출렁였다`).toBeGreaterThan(1);
    // dock/toast: 핀 고정이면 bottom 이 일정, 자연 위치면 bottom+scrollY 가 일정
    for (const [idx, name] of [[0, '#save-dock'], [1, '#toast']]) {
      const base = rest[idx];
      const errs = fr.filter((f) => f.dock[idx]).map((f) => Math.min(Math.abs(f.dock[idx].b - base.b), Math.abs(f.dock[idx].b + f.sy - (base.b + base.sy))));
      console.log(`C-S6 ${label} ${name} 위치 오차 최대 ${Math.max(...errs).toFixed(2)}px (프레임 ${errs.length}), 유닛 최대 |ty| ${moved.toFixed(1)}`);
      expect(Math.max(...errs), `${label} ${name} 위치`).toBeLessThanOrEqual(0.5);
      expect(Math.max(...fr.filter((f) => f.dock[idx]).map((f) => Math.abs(f.dock[idx].w - base.w))), `${label} ${name} 너비`).toBeLessThanOrEqual(0.5);
    }
    const hits = fr.map((f) => f.hit).filter((h) => h !== null);
    console.log(`C-S6 ${label} elementFromPoint(저장 버튼) 프레임 ${hits.length}개 중 참 ${hits.filter(Boolean).length}`);
    if (needHit) expect(hits.length, `${label} 저장 버튼이 보이는 프레임`).toBeGreaterThan(3);
    expect(hits.every(Boolean), `${label} 저장 버튼 위치의 최상단 요소가 저장 버튼`).toBe(true);
  };
  // (A) 위쪽: 저장 영역이 보이는 채로 요약 카드가 출렁임
  await scenario('위쪽(요약 카드)', async () => { await page.evaluate(() => window.scrollTo(0, 0)); }, 300, 150, true);
  // (B) 목록 구간: 행이 출렁임
  await scenario('목록(행)', async () => { await toList(page); }, 400, 400, false);
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-S6 대시보드 탭바 위 토스트: 가운데 정렬·위치 그대로', async ({ browser }, testInfo) => {
  const a = await open(browser, testInfo, { hash: '#dashboard' });
  const { page } = a;
  await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.getElementById('flash').textContent = '확인 토스트'; });
  await page.waitForTimeout(400);
  await page.mouse.move(2, 2);
  const rest = await page.locator('#toast').evaluate((e) => { const r = e.getBoundingClientRect(); return { b: r.bottom, cx: r.left + r.width / 2, vw: document.documentElement.clientWidth, tf: getComputedStyle(e).transform }; });
  expect(Math.abs(rest.cx - rest.vw / 2)).toBeLessThanOrEqual(1);
  const vw = page.viewportSize();
  await startRec(page);
  await page.waitForTimeout(100);
  await wheel(page, vw.width / 2, 300, 500, 5, 16);
  await settleAfterScroll(page);
  const fr = await frames(page);
  expectCommon(fr, '대시보드 토스트');
  const t = fr.map((f) => f.dock[1]).filter(Boolean);
  expect(t.length).toBeGreaterThan(5);
  console.log(`대시보드 토스트 bottom 오차 ${Math.max(...t.map((x) => Math.abs(x.b - rest.b))).toFixed(2)} 가운데 오차 ${Math.max(...t.map((x) => Math.abs(x.cx - rest.vw / 2))).toFixed(2)}`);
  expect(Math.max(...t.map((x) => Math.abs(x.b - rest.b)))).toBeLessThanOrEqual(0.5);
  expect(Math.max(...t.map((x) => Math.abs(x.cx - rest.vw / 2)))).toBeLessThanOrEqual(1);
  expect(await page.locator('#toast').evaluate((e) => getComputedStyle(e).transform)).toBe(rest.tf);
  await a.ctx.close();
});

// ====================================================================== 다른 화면 (대시보드·카테고리·내 정보)
test('C-S1 대시보드 카드가 출렁인다 (카드 단위, 상한 20px)', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo, { hash: '#dashboard' });
  const { page } = a;
  await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
  await page.waitForTimeout(800);
  expect(await maxScroll(page), '대시보드 스크롤 길이').toBeGreaterThan(200);
  const vw = page.viewportSize();
  await startRec(page);
  await page.waitForTimeout(100);
  await wheel(page, vw.width / 2, 500, 600, 6, 16);
  const ms = await settleAfterScroll(page);
  const fr = await frames(page);
  expectCommon(fr, '대시보드');
  const cards = cardFrames(fr).map((x) => x.ty);
  console.log(`대시보드: 카드 최대 |ty| ${maxAbs(cards).toFixed(2)}, 수렴 ${Math.round(ms)}ms, 카드 수 ${fr[0].u.length}`);
  expect(maxAbs(cards), 'C-S1 대시보드 카드 최대 |ty|').toBeGreaterThanOrEqual(6);
  expect(fr.some((f) => { const t = f.u.map((x) => x.ty); return Math.max(...t) - Math.min(...t) >= 2; }), '카드가 독립적으로 움직임').toBe(true);
  expect(ms).toBeLessThanOrEqual(1000);
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

test('C-S1 카테고리 관리: 행이 출렁인다 (사용 안 함 펼친 상태 포함)', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo, { hash: '#categories', viewport: { width: testInfo.project.use.viewport.width, height: 500 } });
  const { page } = a;
  await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
  await page.waitForTimeout(800);
  expect(await maxScroll(page), '카테고리 화면 스크롤 길이').toBeGreaterThan(300);
  const vw = page.viewportSize();
  await startRec(page);
  await page.waitForTimeout(100);
  await wheel(page, vw.width / 2, 250, 400, 4, 16);
  const ms = await settleAfterScroll(page);
  const fr = await frames(page);
  expectCommon(fr, '카테고리 관리');
  console.log(`카테고리 관리: 행 최대 |ty| ${maxAbs(rowFrames(fr).map((x) => x.ty)).toFixed(2)} 수렴 ${Math.round(ms)}ms 행 ${fr[0].u.length}`);
  expect(maxAbs(rowFrames(fr).map((x) => x.ty))).toBeGreaterThanOrEqual(6);
  expect(ms).toBeLessThanOrEqual(1000);
  await a.ctx.close();
});

test('C-S1 내 정보: 카드가 출렁인다 (뷰포트를 낮춰 스크롤 가능하게 함)', async ({ browser }, testInfo) => {
  const a = await open(browser, testInfo, { hash: '#account', viewport: { width: testInfo.project.use.viewport.width, height: 300 } });
  const { page } = a;
  await expect(page.locator('.account-card').first()).toBeVisible();
  await page.waitForTimeout(800);
  const max = await maxScroll(page);
  test.skip(max < 60, `내 정보 화면이 스크롤되지 않음(max ${max})`);
  const vw = page.viewportSize();
  await startRec(page);
  await page.waitForTimeout(100);
  await wheel(page, vw.width / 2, 150, 300, 3, 16);
  await settleAfterScroll(page);
  const fr = await frames(page);
  expectCommon(fr, '내 정보');
  console.log(`내 정보: 카드 최대 |ty| ${maxAbs(cardFrames(fr).map((x) => x.ty)).toFixed(2)} 스크롤 가능 ${max}`);
  expect(maxAbs(cardFrames(fr).map((x) => x.ty))).toBeGreaterThan(0.5);
  await a.ctx.close();
});

// ====================================================================== C-S8 구조
test('C-S8 유닛끼리 조상·자손 아님, 유닛 안에 fixed/sticky 없음 (4개 화면)', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo, { hash: '#record' });
  const { page } = a;
  const check = () => page.evaluate((sel) => {
    const us = [...document.querySelectorAll(sel)];
    const nest = us.filter((u) => us.some((v) => v !== u && v.contains(u))).map((u) => u.className || u.id);
    const bad = us.flatMap((u) => [...u.querySelectorAll('*')].filter((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position)).map((e) => (u.id || u.className) + ' > ' + e.tagName + '.' + e.className)).concat(us.filter((u) => ['fixed', 'sticky'].includes(getComputedStyle(u).position)).map((u) => 'unit ' + (u.id || u.className)));
    const css = us.filter((u) => { const c = getComputedStyle(u); return c.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || c.animationName !== 'none' || c.translate !== 'none'; }).map((u) => u.id || u.className);
    return { n: us.length, nest, bad, css };
  }, UNITS);
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  const res = {};
  res.record = await check();
  for (const [h, w] of [['#dashboard', '#chart-donut .legend li'], ['#categories', '#catm-active .cat-row'], ['#account', '.account-card']]) {
    await goHash(page, h);
    await expect(page.locator(w).first()).toBeVisible();
    if (h === '#categories') { await page.evaluate(() => { const d = document.getElementById('catm-inactive-details'); if (d) d.open = true; }); }
    await page.waitForTimeout(500);
    res[h.slice(1)] = await check();
  }
  console.log('C-S8 ' + JSON.stringify(res));
  for (const [k, v] of Object.entries(res)) {
    expect(v.n, `${k} 유닛 수`).toBeGreaterThan(0);
    expect(v.nest, `${k} 중첩 유닛`).toEqual([]);
    expect(v.bad, `${k} fixed/sticky`).toEqual([]);
    expect(v.css, `${k} 유닛 자체의 CSS transition/animation/translate`).toEqual([]);
  }
  await a.ctx.close();
});

// ====================================================================== C-S10 누르기 정확도
test('C-S10 기록 탭: 출렁이는 도중 보이는 행 중심을 눌러도 그 행의 거래가 열린다 (5회)', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(400);
  const vw = page.viewportSize();
  let wrong = 0;
  const log = [];
  for (let n = 0; n < 5; n++) {
    await toList(page);
    await page.mouse.move(vw.width / 2, 400);
    await page.mouse.wheel(0, 300);
    // 보이는 행 중 하나가 실제로 0 이 아닌 변위를 가질 때까지 기다린 뒤, 그 순간 가장 많이 움직인 행의 보이는 중심을 누른다
    await page.waitForFunction(() => [...document.querySelectorAll('#tx-list .tx-row')].some((e) => { const r = e.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 90 && Math.abs(new DOMMatrixReadOnly(getComputedStyle(e).transform).m42) > 2; }), null, { polling: 'raf', timeout: 2000 });
    const pick = await page.evaluate((k) => {
      const rows = [...document.querySelectorAll('#tx-list .tx-row')].filter((e) => { const r = e.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 90; })
        .map((e) => ({ e, ty: new DOMMatrixReadOnly(getComputedStyle(e).transform).m42 })).sort((p, q) => Math.abs(q.ty) - Math.abs(p.ty));
      const { e, ty } = rows[Math.min(k, rows.length - 1)];
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, memo: e.querySelector('.tx-memo')?.textContent || '', ty, running: document.documentElement.hasAttribute('data-spring') };
    }, n % 3);
    await page.mouse.click(pick.x, pick.y);
    await page.waitForFunction(() => document.getElementById('cancel-edit-btn') && !document.getElementById('cancel-edit-btn').hidden, null, { timeout: 3000 });
    const got = await page.locator('#memo').inputValue();
    log.push(`${pick.memo}->${got} (ty ${pick.ty.toFixed(1)})`);
    if (got !== pick.memo) wrong++;
    await page.locator('#cancel-edit-btn').click();
    await page.waitForTimeout(100);
  }
  console.log('C-S10 기록: ' + log.join(' | '));
  expect(wrong, 'C-S10 다른 행이 열린 횟수').toBe(0);
  await a.ctx.close();
});

test('C-S10 대시보드: 출렁이는 도중 "표로 보기"·지출/수입 버튼이 눌린다', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo, { hash: '#dashboard' });
  const { page } = a;
  await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
  await page.waitForTimeout(800);
  const vw = page.viewportSize();
  const log = [];
  for (const [label, sel, check] of [
    ['수입 버튼', '#catview-income', async () => expect(page.locator('#donut-title')).toHaveText('카테고리별 수입')],
    ['지출 버튼', '#catview-expense', async () => expect(page.locator('#donut-title')).toHaveText('카테고리별 지출')],
    ['표로 보기', '#chart-donut details summary', async () => expect(page.locator('#chart-donut table')).toBeVisible()],
  ]) {
    for (let n = 0; n < 3; n++) {
      await page.evaluate((s) => { document.querySelector(s).scrollIntoView({ block: 'center' }); }, sel);
      await page.waitForTimeout(300);
      await page.mouse.move(vw.width / 2, 150);
      // 끝에서는 더 못 가므로 여유가 있는 쪽으로 휠
      const room = await page.evaluate(() => ({ up: scrollY, down: document.scrollingElement.scrollHeight - innerHeight - scrollY }));
      await page.mouse.wheel(0, room.down >= 160 && (n % 2 === 0 || room.up < 160) ? 150 : -150);
      await page.waitForFunction((s) => { const c = document.querySelector(s).closest('.donut-card'); return Math.abs(new DOMMatrixReadOnly(getComputedStyle(c).transform).m42) > 2; }, sel, { polling: 'raf', timeout: 2000 });
      const pick = await page.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, running: document.documentElement.hasAttribute('data-spring'), ty: new DOMMatrixReadOnly(getComputedStyle(e.closest('.donut-card')).transform).m42 }; }, sel);
      await page.mouse.click(pick.x, pick.y);
      await check();
      log.push(`${label}#${n}(카드 ty ${pick.ty.toFixed(1)})`);
      // 원래 상태로(표로 보기는 접지 않아도 다음 반복에서 계속 열린 상태이므로 한 번만 확인)
      if (label === '표로 보기') break;
    }
  }
  console.log('C-S10 대시보드: ' + log.join(', '));
  await a.ctx.close();
});

// ====================================================================== C-S11 출렁이지 않는 스크롤
test('C-S11 키보드·scrollIntoView·포커스·탭 전환 스크롤에서는 transform 이 none, 스프링 rAF 0', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(2, 2);
  await startRec(page);
  await page.waitForTimeout(100);
  const base = await rafStats(page);
  const step = async (label, fn) => {
    const b0 = (await rafStats(page)).spring;
    const n0 = (await page.evaluate(() => window.__rec.frames.length));
    const sy0 = await page.evaluate(() => scrollY);
    await fn();
    await page.waitForTimeout(500);
    const fr = await page.evaluate((n) => window.__rec.frames.slice(n), n0);
    const sy1 = await page.evaluate(() => scrollY);
    const moved = Math.abs(sy1 - sy0);
    const nonzero = fr.flatMap((f) => f.u).filter((x) => Math.abs(x.ty) > 0.01 || x.inl).length;
    const spring = fr.filter((f) => f.spring).length;
    const rafs = (await rafStats(page)).spring - b0;
    console.log(`C-S11 ${label}: 스크롤 ${Math.round(moved)}px, 0 아닌 유닛 프레임 ${nonzero}, data-spring 프레임 ${spring}, 스프링 rAF ${rafs}`);
    expect(nonzero, `${label} transform`).toBe(0);
    expect(spring, `${label} data-spring`).toBe(0);
    expect(rafs, `${label} 스프링 rAF`).toBe(0);
    return moved;
  };
  expect(await step('PageDown', async () => { await page.keyboard.press('PageDown'); }), 'PageDown 이 실제로 스크롤').toBeGreaterThan(100);
  expect(await step('Space', async () => { await page.keyboard.press('Space'); })).toBeGreaterThan(100);
  expect(await step('End', async () => { await page.keyboard.press('End'); })).toBeGreaterThan(100);
  expect(await step('Home', async () => { await page.keyboard.press('Home'); })).toBeGreaterThan(100);
  await step('ArrowDown 연타', async () => { for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown'); });
  await step('Tab 포커스 이동', async () => { for (let i = 0; i < 25; i++) await page.keyboard.press('Tab'); });
  await step('window.scrollTo(프로그램)', async () => { await page.evaluate(() => window.scrollTo(0, 700)); });
  await step('scrollIntoView(프로그램)', async () => { await page.evaluate(() => document.querySelector('#tx-list .tx-row:nth-child(1)').scrollIntoView({ block: 'center' })); });
  // 거래 수정 진입 (record.js scrollIntoView + #amount 포커스)
  await step('거래 수정 진입(scrollIntoView)', async () => {
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelectorAll('#tx-list .tx-edit')[8].click());
  });
  await expect(page.locator('#cancel-edit-btn')).toBeVisible();
  // 메모 칸 포커스(scroll-padding): 저장 영역에 가려지지 않는다
  await step('메모 칸 포커스', async () => { await page.locator('#memo').focus(); });
  const covered = await page.evaluate(() => { const m = document.getElementById('memo').getBoundingClientRect(); const d = document.getElementById('save-dock').getBoundingClientRect(); return m.bottom > d.top && m.top < d.bottom; });
  expect(covered, '메모 칸이 저장 영역에 가려지지 않음').toBe(false);
  // 탭 전환
  await step('탭 전환(대시보드)', async () => { await page.evaluate(() => window.scrollTo(0, 0)); await goHash(page, '#dashboard'); });
  await step('탭 전환(기록)', async () => { await goHash(page, '#record'); });
  void base;
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

// ====================================================================== C-S12 입력 중
test('C-S12 입력 직후 800ms 안에는 휠 스크롤해도 none, 포커스만 있으면 출렁인다, 출렁이는 중 키 입력은 즉시 0', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(600);
  const vw = page.viewportSize();
  const focusId = await page.evaluate(() => document.activeElement && document.activeElement.id);
  console.log('C-S12 로드 직후 포커스: ' + focusId);
  await toList(page);
  await startRec(page);
  await page.waitForTimeout(100);
  // (a) 포커스만 있는 상태(로드 시 #amount 자동 포커스)에서 휠 -> 출렁여야 한다
  await wheel(page, vw.width / 2, 500, 400, 4, 16);
  await settleAfterScroll(page);
  let fr = await page.evaluate(() => window.__rec.frames);
  console.log(`C-S12(a) 포커스만: 최대 행 |ty| ${maxAbs(rowFrames(fr).map((x) => x.ty)).toFixed(2)} (포커스 ${await page.evaluate(() => document.activeElement.id)})`);
  expect(maxAbs(rowFrames(fr).map((x) => x.ty)), '포커스만 있으면 출렁인다').toBeGreaterThanOrEqual(3);
  // (b) 입력 직후 휠 -> none
  await toList(page);
  await page.locator('#amount').focus();
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await page.keyboard.type('12');
  const b0 = (await rafStats(page)).spring;
  await wheel(page, vw.width / 2, 500, 400, 4, 16);
  await page.waitForTimeout(300);
  fr = await page.evaluate(() => window.__rec.frames);
  const nz = fr.flatMap((f) => f.u).filter((x) => Math.abs(x.ty) > 0.01 || x.inl).length;
  console.log(`C-S12(b) 타이핑 직후 휠: 0 아닌 유닛 프레임 ${nz}, 스프링 rAF ${(await rafStats(page)).spring - b0}`);
  expect(nz, '입력 직후 transform').toBe(0);
  expect((await rafStats(page)).spring - b0, '입력 직후 스프링 rAF').toBe(0);
  // (c) 800ms 이상 지난 뒤(포커스는 그대로) 다시 휠 -> 출렁
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await wheel(page, vw.width / 2, 500, 400, 4, 16);
  await settleAfterScroll(page);
  fr = await page.evaluate(() => window.__rec.frames);
  console.log(`C-S12(c) 1초 뒤 휠: 최대 행 |ty| ${maxAbs(rowFrames(fr).map((x) => x.ty)).toFixed(2)}`);
  expect(maxAbs(rowFrames(fr).map((x) => x.ty)), '입력 800ms 뒤에는 다시 출렁인다').toBeGreaterThanOrEqual(3);
  // (d) 출렁이는 도중 키 입력 -> 다음 프레임에 전부 0
  await toList(page);
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await page.mouse.move(vw.width / 2, 500);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-spring'), null, { polling: 'raf' });
  await page.waitForTimeout(30);
  const midMax = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#tx-list .tx-row')].map((e) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(e).transform).m42))));
  await page.keyboard.type('3');
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(100);
  fr = await page.evaluate(() => window.__rec.frames);
  const after = fr.filter((f) => f.t > t0 + 40);
  console.log(`C-S12(d) 출렁이는 중 키 입력: 직전 최대 ${midMax.toFixed(2)}, 입력 뒤 40ms 이후 프레임 ${after.length}개의 최대 |ty| ${maxAbs(after.flatMap((f) => f.u.map((x) => x.ty))).toFixed(3)}`);
  expect(midMax, '입력 전에 실제로 출렁이고 있었음').toBeGreaterThan(0.5);
  expect(maxAbs(after.flatMap((f) => f.u.map((x) => x.ty)))).toBe(0);
  await a.ctx.close();
});

test('C-S12 카테고리 이름 바꾸기 입력에서도 입력 직후에는 출렁이지 않는다', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo, { hash: '#categories', viewport: { width: testInfo.project.use.viewport.width, height: 500 } });
  const { page } = a;
  await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
  await page.waitForTimeout(600);
  const rename = page.locator('#catm-active .cat-row button', { hasText: /이름/ }).first();
  test.skip(!(await rename.count()), '이름 바꾸기 버튼을 찾지 못함');
  await rename.click();
  const input = page.locator('#catm-active .cat-row input[type="text"]').first();
  await expect(input).toBeVisible();
  const vw = page.viewportSize();
  await startRec(page);
  await input.focus();
  await page.keyboard.type('가');
  await wheel(page, vw.width / 2, 250, 300, 3, 16);
  await page.waitForTimeout(300);
  const fr = await frames(page);
  const nz = fr.flatMap((f) => f.u).filter((x) => Math.abs(x.ty) > 0.01 || x.inl).length;
  console.log(`C-S12 카테고리 이름 입력 직후 휠: 0 아닌 유닛 프레임 ${nz}`);
  expect(nz).toBe(0);
  await a.ctx.close();
});

// ====================================================================== C-S13 끝 튕김
test('C-S13 맨 위·맨 아래에서 더 스크롤해도 상한을 넘지 않고, 맨 위에서 위로 휠은 출렁임이 없다', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(500);
  const vw = page.viewportSize();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await startRec(page);
  await page.waitForTimeout(100);
  // 맨 위에서 위로 휠: 스크롤 이벤트가 없으므로 아무것도 안 움직인다
  await wheel(page, vw.width / 2, 400, -600, 3, 16);
  await page.waitForTimeout(400);
  let fr = await page.evaluate(() => window.__rec.frames);
  const topMax = maxAbs(fr.flatMap((f) => f.u.map((x) => x.ty)));
  console.log(`C-S13 맨 위에서 위로 휠: 최대 |ty| ${topMax.toFixed(3)}`);
  expect(topMax).toBe(0);
  // 맨 아래까지 간 뒤 더 아래로 휠
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await wheel(page, vw.width / 2, 400, 800, 4, 16);
  await page.waitForTimeout(500);
  fr = await page.evaluate(() => window.__rec.frames);
  const botMax = maxAbs(fr.flatMap((f) => f.u.map((x) => x.ty)));
  console.log(`C-S13 맨 아래에서 더 아래로 휠: 최대 |ty| ${botMax.toFixed(3)}`);
  expectCommon(fr, '맨 아래');
  expect(botMax).toBe(0);
  await a.ctx.close();
});

// ====================================================================== C-S14 움직임 줄이기
test('C-S14 reducedMotion reduce 로 연 페이지: 같은 스크롤에도 transform·will-change·data-spring·스프링 rAF 없음', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const a = await open(browser, testInfo, { motion: 'reduce' });
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const vw = page.viewportSize();
  await toList(page);
  await startRec(page);
  await page.waitForTimeout(100);
  await wheel(page, vw.width / 2, 500, 800, 8, 16);
  if (isTouch(testInfo)) await touchScroll(page, 180, 650, 400, { steps: 10, gap: 16 });
  await page.waitForTimeout(800);
  const fr = await frames(page);
  expect(fr.length).toBeGreaterThan(20);
  expect(fr.at(-1).sy, '실제로 스크롤됨').toBeGreaterThan(100);
  expect(fr.flatMap((f) => f.u).filter((x) => Math.abs(x.ty) > 0 || x.inl || x.will).length, '유닛 transform·will-change').toBe(0);
  expect(fr.filter((f) => f.hot > 0 || f.spring).length, 'data-spring·인라인 transform 프레임').toBe(0);
  expect(await springRaf(page), '스프링 rAF').toBe(0);
  const lst = await page.evaluate(() => window.__listeners.filter((l) => l.stack).length);
  console.log(`C-S14 reduce: scroll-spring 이 등록한 리스너 ${lst}개`);
  expect(lst, 'reduce 로 열면 scroll-spring 리스너 0').toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('[data-spring-unit]').length), 'reduce 로 열면 data-spring-unit 속성 0').toBe(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('#tx-list .tx-row')].filter((e) => getComputedStyle(e).transform !== 'none').length), 'reduce: 상시 transform 없음').toBe(0);
  await a.ctx.close();
});

test('C-S14 실행 중 emulateMedia 로 reduce 를 켜면 즉시(다음 프레임) 모든 유닛이 0, 이후 스크롤도 없음, 되돌리면 다시 출렁', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(500);
  const vw = page.viewportSize();
  await toList(page);
  await startRec(page);
  await page.waitForTimeout(100);
  await page.mouse.move(vw.width / 2, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-spring'), null, { polling: 'raf' });
  await page.waitForTimeout(30);
  const mid = await page.evaluate(() => [...document.querySelectorAll('#tx-list .tx-row')].filter((e) => e.style.transform).length);
  expect(mid, 'reduce 전환 직전 출렁이는 유닛이 있음').toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const hot = await page.evaluate(() => ({ inl: [...document.querySelectorAll('[style]')].filter((e) => e.style.transform || e.style.willChange).length, spring: document.documentElement.hasAttribute('data-spring'), raf: window.__raf.spring }));
  console.log(`C-S14 reduce 전환 2프레임 뒤: 인라인 transform 요소 ${hot.inl}, data-spring ${hot.spring}`);
  expect(hot.inl, '전환 뒤 인라인 transform').toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('[data-spring-unit]').length), '전환 뒤 data-spring-unit 0').toBe(0);
  expect(hot.spring).toBe(false);
  const r1 = await springRaf(page);
  await toList(page);
  await wheel(page, vw.width / 2, 500, 600, 6, 16);
  await page.waitForTimeout(700);
  expect(await springRaf(page) - r1, 'reduce 중 스프링 rAF').toBe(0);
  const fr = await page.evaluate((t) => window.__rec.frames.filter((f) => f.t > t + 50), t0);
  expect(fr.flatMap((f) => f.u).filter((x) => Math.abs(x.ty) > 0 || x.inl).length, 'reduce 중 스크롤 transform').toBe(0);
  // 되돌리기: no-preference 로 바꾸면 다시 붙는다
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(200);
  await toList(page);
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await wheel(page, vw.width / 2, 500, 600, 6, 16);
  await settleAfterScroll(page);
  const fr2 = await page.evaluate(() => window.__rec.frames);
  console.log(`C-S14 no-preference 복귀: 최대 행 |ty| ${maxAbs(rowFrames(fr2).map((x) => x.ty)).toFixed(2)}`);
  expect(maxAbs(rowFrames(fr2).map((x) => x.ty)), '복귀하면 다시 출렁인다').toBeGreaterThanOrEqual(3);
  await a.ctx.close();
});

// ====================================================================== C-S15 스위치
test('C-S15 SPRING.enabled=false 로 바꾼 빌드(라우트로 spring.js 치환): 리스너·rAF·transform 0', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const u = await sharedUser();
  const run = async (disabled) => {
    const ui = await newUiPage(browser, testInfo, { api: u.api, reducedMotion: 'no-preference' });
    const { page } = ui;
    await page.addInitScript(INIT);
    if (disabled) {
      await page.route('**/js/lib/spring.js', async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).replace(/enabled:\s*true/, 'enabled: false');
        expect(body).toContain('enabled: false');
        await route.fulfill({ response: res, body });
      });
    }
    await page.goto('/#record');
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await page.waitForTimeout(500);
    const vw = page.viewportSize();
    await toList(page);
    await startRec(page);
    await page.waitForTimeout(100);
    await wheel(page, vw.width / 2, 500, 600, 6, 16);
    await page.waitForTimeout(800);
    const fr = await frames(page);
    const out = {
      lst: await page.evaluate(() => window.__listeners.filter((l) => l.stack).length),
      springRaf: await springRaf(page),
      moved: maxAbs(fr.flatMap((f) => f.u.map((x) => x.ty))),
      dataSpring: fr.some((f) => f.spring),
      sy: fr.at(-1).sy,
    };
    await ui.ctx.close();
    return out;
  };
  const on = await run(false);
  const off = await run(true);
  console.log('C-S15 켬=' + JSON.stringify(on) + ' 끔=' + JSON.stringify(off));
  expect(on.lst, '켬: scroll-spring 리스너가 붙음').toBeGreaterThan(5);
  expect(off.lst, '끔: 리스너 0').toBe(0);
  expect(off.springRaf).toBe(0);
  expect(off.moved).toBe(0);
  expect(off.dataSpring).toBe(false);
  expect(off.sy, '끔에서도 스크롤은 된다').toBeGreaterThan(100);
  expect(on.moved).toBeGreaterThan(3);
  expect(on.lst, '켠 쪽의 passive 확인').toBeGreaterThan(0);
});

test('C-S15 리스너는 모두 passive (켠 상태에서 scroll-spring 이 등록한 scroll·wheel·touch)', async ({ browser }, testInfo) => {
  const a = await open(browser, testInfo);
  const l = await a.page.evaluate(() => window.__listeners.filter((x) => x.stack));
  console.log('C-S15 scroll-spring 리스너: ' + l.map((x) => x.type + (x.passive ? '(p)' : '(NP)')).join(' '));
  expect(l.length).toBeGreaterThan(5);
  expect(l.filter((x) => !x.passive).map((x) => x.type), 'passive 가 아닌 리스너').toEqual([]);
  await a.ctx.close();
});

// ====================================================================== C-S16 성능
test('C-S16 성능 근사(CPU 4배 느림): 켬/끔 LayoutCount 차이, long task, rAF 간격 p95, 활성 유닛 40개 이하', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const u = await sharedUser();
  const run = async (motion) => {
    const ui = await newUiPage(browser, testInfo, { api: u.api, reducedMotion: motion });
    const { page } = ui;
    await page.addInitScript(INIT);
    await page.goto('/#record');
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await page.waitForTimeout(600);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const metric = async (n) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === n).value;
    // 가벼운 기록기: rAF 간격과 인라인 transform 수만
    await page.evaluate(() => {
      const r = { dts: [], hot: [], last: 0, stop: false };
      window.__perf = r;
      const loop = (ts) => { if (r.stop) return; if (r.last) r.dts.push(ts - r.last); r.last = ts; r.hot.push(document.querySelectorAll('[style*="transform"]').length); window.__rafOrig(loop); };
      window.__rafOrig(loop);
    });
    await toList(page);
    await page.waitForTimeout(300);
    const vw = page.viewportSize();
    const L0 = await metric('LayoutCount');
    const S0 = await metric('RecalcStyleCount');
    await page.mouse.move(vw.width / 2, 500);
    for (let k = 0; k < 6; k++) {
      await wheel(page, vw.width / 2, 500, k % 2 ? -500 : 700, 7, 16);
      await page.waitForTimeout(700);
    }
    const L1 = await metric('LayoutCount');
    const S1 = await metric('RecalcStyleCount');
    const perf = await page.evaluate(() => { window.__perf.stop = true; return { dts: window.__perf.dts, hot: window.__perf.hot, long: window.__longtasks }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const sorted = [...perf.dts].sort((p, q) => p - q);
    const out = { layout: L1 - L0, style: S1 - S0, p95: sorted[Math.floor(sorted.length * 0.95)], p50: sorted[Math.floor(sorted.length * 0.5)], long: perf.long, maxHot: Math.max(...perf.hot), n: sorted.length };
    await ui.ctx.close();
    return out;
  };
  const off1 = await run('reduce');
  const on = await run('no-preference');
  const off2 = await run('reduce');
  console.log('C-S16 끔1=' + JSON.stringify(off1) + '\nC-S16 켬 =' + JSON.stringify(on) + '\nC-S16 끔2=' + JSON.stringify(off2));
  const offLayout = Math.max(off1.layout, off2.layout);
  const offP95 = Math.max(off1.p95, off2.p95);
  expect.soft(on.layout - Math.min(off1.layout, off2.layout), 'LayoutCount 차이').toBeLessThanOrEqual(2);
  expect.soft(on.long, 'long task(켬, 실행당 1건 이하)').toBeLessThanOrEqual(1);
  expect.soft(on.p95 - offP95, 'rAF 간격 p95 차이(ms, 완화 기준 +12)').toBeLessThanOrEqual(12);
  expect(on.maxHot, '동시 인라인 transform 요소 수').toBeLessThanOrEqual(40);
  void offLayout;
});

test('C-S16 자동 꺼짐: 느린 프레임 제스처가 연속 2번이면 그 세션에서 꺼진다 (새로고침하면 다시 켜짐)', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(500);
  const vw = page.viewportSize();
  await startRec(page);
  // 모든 프레임에 40ms 바쁜 루프를 넣어 프레임 간격 중앙값을 25ms 초과로 만든다
  await page.evaluate(() => { window.__slow = true; const burn = () => { if (!window.__slow) return; const s = performance.now(); while (performance.now() - s < 40); window.__rafOrig(burn); }; window.__rafOrig(burn); });
  const gesture = async (dy) => { await wheel(page, vw.width / 2, 500, dy, 12, 30); await page.waitForTimeout(600); };
  await toList(page);
  const moved = async () => page.evaluate(() => window.__rec.frames.some((f) => f.u.some((x) => Math.abs(x.ty) > 0.5)));
  await gesture(500);
  const m1 = await moved();
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await gesture(-400);
  const m2 = await moved();
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await gesture(500);
  const m3 = await moved();
  await page.evaluate(() => { window.__rec.frames.length = 0; });
  await gesture(-300);
  const m4 = await moved();
  const lst = await page.evaluate(() => { window.__slow = false; return 0; });
  void lst;
  console.log(`C-S16 자동 꺼짐: 제스처1 움직임 ${m1}, 2 ${m2}, 3 ${m3}, 4 ${m4}`);
  expect(m1, '첫 제스처는 아직 켜져 있어 움직임').toBe(true);
  expect(m3 || m4, '연속 느린 2제스처 뒤에는 꺼져 움직임이 없다').toBe(false);
  // 새로고침하면 다시 켜짐
  await page.reload();
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  await page.waitForTimeout(500);
  await toList(page);
  await startRec(page);
  await page.waitForTimeout(100);
  await wheel(page, vw.width / 2, 500, 600, 6, 16);
  await settleAfterScroll(page);
  const fr = await frames(page);
  expect(maxAbs(rowFrames(fr).map((x) => x.ty)), '새로고침 뒤 다시 출렁임').toBeGreaterThanOrEqual(3);
  await a.ctx.close();
});

// ====================================================================== C-S9 1차 모션 공존
test('C-S9 출렁이는 중에 달을 바꿔도 카드 페이드(mb-fade-in)와 막대(mb-grow-x)가 재생되고 끝나면 transform none', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const a = await open(browser, testInfo, { hash: '#dashboard' });
  const { page } = a;
  await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__an = []; document.addEventListener('animationstart', (e) => window.__an.push(e.animationName), true); });
  const vw = page.viewportSize();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.mouse.move(vw.width / 2, 300);
  await page.mouse.wheel(0, 40);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-spring'), null, { polling: 'raf' });
  await page.locator('#dash-prev').click({ force: true });
  await expect(page.locator('#dash-month')).toHaveText('2026년 9월');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-spring') && document.getAnimations().length === 0, null, { timeout: 5000 });
  const names = await page.evaluate(() => window.__an);
  console.log('C-S9 시작된 애니메이션: ' + JSON.stringify([...new Set(names)]) + ' 개수 ' + names.length);
  expect(names).toContain('mb-fade-in');
  expect(names).toContain('mb-grow-x');
  const st = await page.evaluate(() => ['#kpi', '.donut-card', '#kpi > *', '#chart-donut > *', '.legend-bar__fill'].map((s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return { s, op: c.opacity, tf: c.transform, tr: c.translate }; }));
  for (const x of st) { expect(x.op, x.s).toBe('1'); expect(isIdentity(x.tf), `${x.s} transform ${x.tf}`).toBe(true); expect(x.tr, x.s).toBe('none'); }
  expect(a.problems).toEqual([]);
  await a.ctx.close();
});

// ====================================================================== C-S17, C-S18 정적·범위
test('C-S17 CSP 위반·콘솔 오류 0, 인라인 <style>·<script>·style 속성 없음, 탭 이동 반복 뒤 리스너 수 불변', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  for (const f of ['index.html', 'login.html']) {
    const html = readFileSync(join(PUBLIC, f), 'utf8');
    expect(html, f).not.toMatch(/\sstyle\s*=|<style[\s>]|<script(?![^>]*\bsrc=)[^>]*>/i);
  }
  const a = await open(browser, testInfo);
  const { page } = a;
  await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
  const n0 = await page.evaluate(() => window.__listeners.filter((l) => l.stack).length);
  const vw = page.viewportSize();
  for (let i = 0; i < 4; i++) {
    for (const h of ['#dashboard', '#categories', '#account', '#record']) { await goHash(page, h); await page.waitForTimeout(250); await wheel(page, vw.width / 2, 400, 200, 2, 16); }
  }
  const n1 = await page.evaluate(() => window.__listeners.filter((l) => l.stack).length);
  console.log(`C-S17 탭 16회 이동 전후 scroll-spring 리스너 ${n0} -> ${n1}`);
  expect(n1).toBe(n0);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(a.problems).toEqual([]);
  expect(await page.evaluate(() => [...document.querySelectorAll('[style]')].filter((e) => e.style.transform).length), '정지 뒤 남은 인라인 transform').toBe(0);
  await a.ctx.close();
});

// 비교 기준은 고정 커밋이다: 스프링 직전 6fd78dd 와 스프링 커밋 da627b1. 이후 다른 기능이 파일을 고쳐도 이 시험은 깨지지 않는다.
test('C-S18 변경 범위(6fd78dd..da627b1): style.css 는 [data-spring-unit] 한 블록만, tokens·components·backend·schema·api.md·office 변경 없음, 변경 파일은 허용 폴더 안', async ({}, testInfo) => {
  onlyMobile(testInfo);
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const FROM = '6fd78dd';
  const TO = 'da627b1';
  expect(git('diff', '--name-only', FROM, TO, '--', 'src/backend', 'docs/api.md', 'src/frontend/public/css/tokens.css', 'src/frontend/public/css/components.css', 'src/frontend/office').trim()).toBe('');
  const diff = git('diff', '-U0', FROM, TO, '--', 'src/frontend/public/css/style.css');
  const lines = diff.split(String.fromCharCode(10)).map((l) => l.replace(String.fromCharCode(13), ''));
  const added = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1).trim()).filter(Boolean);
  const removed = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
  expect(removed, 'style.css 에서 지운 줄').toEqual([]);
  const code = added.filter((l) => !l.startsWith('/*') && !l.startsWith('*') && !/\*\/$/.test(l));
  console.log('C-S18 style.css 추가 코드 줄: ' + JSON.stringify(code));
  expect(code, 'style.css 변경은 [data-spring-unit] 한 블록만').toEqual(['[data-spring-unit] { transform: translate3d(0, 0, 0); }']);
  const changed = git('diff', '--name-only', FROM, TO).split(String.fromCharCode(10)).filter(Boolean);
  const allowed = /^(src\/frontend\/public\/js\/|src\/frontend\/public\/css\/style\.css$|src\/frontend\/test\/|e2e\/|docs\/|design_handoff_moneybook\/)/;
  expect(changed.filter((f) => !allowed.test(f)), '허용 폴더 밖 변경').toEqual([]);
});

// ====================================================================== 재검증: 상시 transform 과 글자 선명도
for (const scheme of ['light', 'dark']) {
  test(`재검증 [${scheme}] DPR 3 폰: 상시 translate3d(0) 때문에 글자가 흐려지는지 (data-spring-unit 유무 스크린샷 비교, docs/qa-shots-spring/)`, async ({ browser }, testInfo) => {
    onlyMobile(testInfo);
    test.setTimeout(90_000);
    const u = await sharedUser();
    const ctx = await browser.newContext({
      baseURL: testInfo.project.use.baseURL, viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      timezoneId: 'Asia/Seoul', locale: 'ko-KR', reducedMotion: 'no-preference', colorScheme: scheme, storageState: await u.api.storageState(),
      extraHTTPHeaders: process.env.TRUST_PROXY === 'true' ? { 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } : undefined,
    });
    await ctx.clock.setFixedTime(new Date('2026-10-19T12:00:00+09:00'));
    const page = await ctx.newPage();
    await page.goto('/#record');
    await expect(page.locator('#tx-list .tx-row').first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.addStyleTag({ content: '*{caret-color:transparent!important}' }).catch(() => {});
    const dir = join(ROOT, 'docs', 'qa-shots-spring');
    mkdirSync(dir, { recursive: true });
    const marked = await page.evaluate(() => [...document.querySelectorAll('[data-spring-unit]')].length);
    expect(marked, '정지 상태에서도 유닛에 data-spring-unit 이 붙어 있음').toBeGreaterThan(10);
    const results = {};
    const shoot = async (name, sel) => {
      await page.evaluate((s) => { document.querySelector(s).scrollIntoView({ block: 'center' }); }, sel);
      await page.waitForTimeout(400);
      const loc = page.locator(sel).first();
      const withAttr = await loc.screenshot({ animations: 'disabled' });
      await page.evaluate((s) => document.querySelector(s).removeAttribute('data-spring-unit'), sel);
      await page.waitForTimeout(150);
      const without = await loc.screenshot({ animations: 'disabled' });
      await page.evaluate((s) => document.querySelector(s).setAttribute('data-spring-unit', ''), sel);
      const fs = await import('node:fs');
      fs.writeFileSync(join(dir, `${name}-${scheme}-360x3.png`), withAttr);
      fs.writeFileSync(join(dir, `${name}-${scheme}-360x3-without-attr.png`), without);
      results[name] = { identical: withAttr.equals(without), bytesWith: withAttr.length, bytesWithout: without.length };
    };
    await shoot('record-row', '#tx-list .tx-row:nth-child(1)');
    await shoot('record-totals', '#month-totals');
    await goHash(page, '#dashboard');
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    await page.waitForTimeout(1200);
    await shoot('dashboard-kpi', '#kpi');
    await shoot('dashboard-donut', '.donut-card');
    console.log(`재검증 [${scheme}] 글자 선명도 비교: ` + JSON.stringify(results));
    await ctx.close();
  });
}
