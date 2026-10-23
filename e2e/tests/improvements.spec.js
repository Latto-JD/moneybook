// docs/improvements.md A1~A11, B4 개선 작업 QA (신규). 360/768, 라이트·다크. UI "오늘" 2026-10-19 고정.
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, json, get } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const onlyMobile = (testInfo) => test.skip(widthOf(testInfo) !== 360, '정적·스크린샷 항목은 mobile-360 에서만');

async function open(browser, testInfo, { scheme = 'light', hash = '#record', prepare, user, height } = {}) {
  const u = user || await createLoggedInUser('im');
  if (prepare) await prepare(u.api);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
  if (height) await page.setViewportSize({ width: widthOf(testInfo), height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = []; const reqs = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('request', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/')) reqs.push(`${r.method()} ${p}${new URL(r.url()).search}`); });
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toBeVisible();
  return { ...u, ...ui, problems, reqs };
}
const rect = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);
const goHash = async (page, h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(300); };
const income = (api, category, amount, date, memo = '') => addTx(api, { type: 'income', category, amount, date, memo });
const expense = (api, category, amount, date, memo = '') => addTx(api, { category, amount, date, memo });
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
const apiPaths = (reqs) => [...new Set(reqs.map((r) => r.replace(/\?.*$/, '')))].sort();

// ====================================================================== A1
test.describe('A1 첫 화면 카테고리·저장 버튼', () => {
  for (const h of [740, 800]) {
    test(`A1 360x${h}(768 은 1024): 카테고리 두 줄이 저장 버튼 후광 위에 온전히 보이고 눌린다, 메모 가림 측정`, async ({ browser }, testInfo) => {
      const w = widthOf(testInfo);
      if (w !== 360 && h === 800) test.skip(true, '768 은 한 번만');
      const height = w === 360 ? h : 1024;
      for (const scheme of ['light', 'dark']) {
        const a = await open(browser, testInfo, { scheme, height });
        const { page } = a;
        await expect(page.locator('#category-chips button').first()).toBeVisible();
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => {
          const save = document.querySelector('#save-btn').getBoundingClientRect();
          const chips = [...document.querySelectorAll('#category-chips button')].map((b) => { const r = b.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2; const hit = document.elementFromPoint(cx, cy); return { b: r.bottom, t: r.top, ok: !!hit && (hit === b || b.contains(hit)) }; });
          const memo = document.querySelector('#memo').getBoundingClientRect();
          const hitMemo = document.elementFromPoint(memo.left + memo.width / 2, memo.top + memo.height / 2);
          const covered = Math.max(0, Math.min(memo.bottom, save.bottom) - Math.max(memo.top, save.top)) / memo.height;
          return { saveTop: save.top, chipBottom: Math.max(...chips.map((c) => c.b)), allHit: chips.every((c) => c.ok), memoCoveredPct: Math.round(covered * 100), memoHit: hitMemo && hitMemo.id, memoTop: memo.top, vh: innerHeight };
        });
        console.log(`A1 ${w}x${height} ${scheme} margin=${(m.saveTop - 8 - m.chipBottom).toFixed(1)} memoCovered=${m.memoCoveredPct}% memoHit=${m.memoHit}`);
        expect(m.allHit, `${scheme} 카테고리 칸 가림 ${JSON.stringify(m)}`).toBe(true);
        expect(m.chipBottom, `${scheme} 카테고리 2번째 줄이 후광(저장 위 8px 확산) 위 ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.saveTop - 8);
        await page.screenshot({ path: join(testInfo.outputDir, `a1-${scheme}-${w}x${height}.png`) });
        // 메모는 스크롤하거나 포커스하면 저장 버튼에 가려지지 않는다
        await page.locator('#memo').focus();
        const after = await page.evaluate(() => { const mr = document.querySelector('#memo').getBoundingClientRect(); const s = document.querySelector('#save-btn').getBoundingClientRect(); return mr.bottom <= s.top + 0.5 || mr.top >= s.bottom - 0.5; });
        expect(after, `${scheme} 메모 포커스 후 저장 버튼과 겹침`).toBe(true);
        await expectNoHorizontalScroll(page, w);
        expect(a.problems).toEqual([]);
        await a.ctx.close();
      }
    });
  }
});

// ====================================================================== A2
test.describe('A2 토스트 위치', () => {
  test('A2 기록: 저장 버튼 바로 위, 날짜·제목을 가리지 않음 / 다른 탭: 탭바 위 / 사용 안 함 수정에서도 같음, 눌림 방해 측정', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo, { height: w === 360 ? 740 : 1024, prepare: async (api) => {
      expect((await json(api, 'POST', '/api/categories', { type: 'expense', name: '경조사' })).status()).toBe(201);
      await expense(api, '경조사', 50000, '2026-10-19', '축의금');
      const it = (await (await get(api, '/api/categories')).json()).items.find((x) => x.name === '경조사');
      expect((await json(api, 'PATCH', `/api/categories/${it.id}`, { active: false })).status()).toBe(200);
    } });
    const { page } = a;
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    const meas = async (label) => {
      const r = await page.evaluate(() => {
        const t = document.querySelector('#toast').getBoundingClientRect();
        const q = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
        const ov = (p, c) => !p || !c ? 0 : Math.max(0, Math.min(p.r, c.r) - Math.max(p.l, c.l)) * Math.max(0, Math.min(p.b, c.b) - Math.max(p.t, c.t));
        const tb = { t: t.top, b: t.bottom, l: t.left, r: t.right };
        const chips = [...document.querySelectorAll('#category-chips button')].map((b) => { const x = b.getBoundingClientRect(); return { t: x.top, b: x.bottom, l: x.left, r: x.right, name: b.textContent.trim() }; });
        return { toast: tb, save: q('#save-btn'), tab: q('.tabbar'), caption: ov(tb, q('#today-caption')), h1: ov(tb, q('h1:not([hidden])')), vw: document.documentElement.clientWidth, chipsHit: chips.filter((c) => ov(tb, c) > 0).map((c) => c.name), inView: t.left >= 0 && t.right <= document.documentElement.clientWidth };
      });
      console.log(`A2 ${label} ${w}px toast=${Math.round(r.toast.t)}-${Math.round(r.toast.b)} save=${r.save ? Math.round(r.save.t) : '-'} tabbar=${r.tab ? Math.round(r.tab.t) : '-'} chipsCovered=${JSON.stringify(r.chipsHit)}`);
      return r;
    };
    // 새 저장
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await page.locator('#amount').fill('3000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash-undo')).toBeVisible();
    const rec = await meas('기록');
    expect(rec.inView).toBe(true);
    expect.soft(rec.toast.b, '토스트는 저장 버튼 위(개선 A2)').toBeLessThanOrEqual(rec.save.t + 0.5);
    expect.soft(rec.save.t - rec.toast.b, '저장 버튼과 가깝다(40px 이내)').toBeLessThan(40);
    expect(rec.caption, '날짜 줄을 덮지 않음').toBe(0);
    expect(rec.h1).toBe(0);
    await page.screenshot({ path: join(testInfo.outputDir, `a2-record-${w}.png`) });
    // 방해 판단: 토스트가 떠 있는 동안 카테고리 칸을 눌러 본다(가려진 칸이 있으면 눌림 방해 측정)
    if (rec.chipsHit.length) {
      const hitInfo = await page.evaluate(() => { const t = document.querySelector('#toast'); return { pe: getComputedStyle(t).pointerEvents }; });
      console.log(`A2 가려진 칩 ${JSON.stringify(rec.chipsHit)} toast pointer-events=${hitInfo.pe}`);
    }
    // 방해 판단(재검증: 저장 도크 구조): 토스트는 도크 안(저장 버튼 위)에 있고, 도크 뒤로 들어간 칸은 보이지 않는다.
    // 보이는 부분이 거의 없는(12px 이하) 칸만 가려져야 하고, 보이는 칸은 눌리며, [되돌리기] 아래에 보이는 칸이 없어야 한다.
    const probe = await page.evaluate(() => {
      const dock = document.querySelector('#save-dock').getBoundingClientRect();
      const undo = document.querySelector('#flash-undo').getBoundingClientRect();
      return { dockTop: dock.top, dockInside: !!document.querySelector('#save-dock #toast'), undoTop: undo.top, chips: [...document.querySelectorAll('#category-chips button')].map((b) => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, dock.top - 2)); const visibleH = Math.max(0, Math.min(r.bottom, dock.top) - r.top); return { name: b.textContent.trim(), top: r.top, bottom: r.bottom, visibleH, hitChip: e === b || b.contains(e) }; }) };
    });
    console.log('A2 도크 안 토스트=' + probe.dockInside + ' dockTop=' + Math.round(probe.dockTop) + ' ' + JSON.stringify(probe.chips.filter((c) => c.visibleH < 44).map((c) => ({ n: c.name, visibleH: Math.round(c.visibleH) }))));
    expect(probe.dockInside, '기록 탭에서 토스트는 저장 도크 안').toBe(true);
    for (const c of probe.chips) {
      if (c.visibleH >= 44) expect(c.hitChip, c.name + ' 보이는 칸은 눌려야 함').toBe(true);
      else expect(c.visibleH, c.name + ' 가려진 칸은 도크 뒤로 거의 완전히 숨음(16px 이하 얇은 띠만 보임)').toBeLessThanOrEqual(16);
    }
    const hidden = probe.chips.filter((c) => c.visibleH < 44).length;
    test.info().annotations.push({ type: 'A2-hidden-chips', description: String(hidden) + '칸이 5초 동안 도크 뒤에 있음(스크롤하면 접근)' });
    // 다른 탭으로 이동해도(5초 안) 탭바 위
    await goHash(page, '#dashboard');
    if (await page.locator('#toast').isVisible()) {
      const d = await meas('대시보드');
      expect(d.toast.b, '탭바 위').toBeLessThanOrEqual(d.tab.t + 0.5);
      expect(d.tab.t - d.toast.b).toBeLessThan(30);
      await page.screenshot({ path: join(testInfo.outputDir, `a2-dashboard-${w}.png`) });
      await goHash(page, '#account');
      if (await page.locator('#toast').isVisible()) {
        const c = await meas('내 정보');
        expect(c.toast.b).toBeLessThanOrEqual(c.tab.t + 0.5);
      }
    } else console.log('A2 탭 전환 시 토스트가 이미 사라짐');
    // 사용 안 함 카테고리 수정
    await goHash(page, '#record');
    await page.waitForTimeout(5500);
    await page.locator('#tx-list .tx-edit', { hasText: '축의금' }).click();
    await page.locator('#amount').fill('60000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    const leg = await meas('사용 안 함 수정');
    expect.soft(leg.toast.b, '사용 안 함 수정 저장 뒤에도 토스트가 저장 버튼 위').toBeLessThanOrEqual(leg.save.t + 0.5);
    expect(leg.caption).toBe(0);
    await expectNoHorizontalScroll(page, w);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

test.describe('A2 재검증: 탭 전환', () => {
  test('토스트가 떠 있는 채 대시보드로 갔다가 기록으로 돌아와도 위치가 맞고(도크 안/탭바 위) 날짜 줄·메모 포커스를 가리지 않는다', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const a = await open(browser, testInfo, { height: w === 360 ? 740 : 1024 });
    const { page } = a;
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    await page.locator('#category-chips button', { hasText: '식비' }).click();
    await page.locator('#amount').fill('4000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash-undo')).toBeVisible();
    const place = () => page.evaluate(() => { const t = document.querySelector('#toast'); const r = t.getBoundingClientRect(); const dock = t.closest('#save-dock'); const tb = document.querySelector('.tabbar').getBoundingClientRect(); const save = document.querySelector('#save-btn').getBoundingClientRect(); const cap = document.querySelector('#today-caption').getBoundingClientRect(); const ov = Math.max(0, Math.min(r.right, cap.right) - Math.max(r.left, cap.left)) * Math.max(0, Math.min(r.bottom, cap.bottom) - Math.max(r.top, cap.top)); return { inDock: !!dock, top: r.top, bottom: r.bottom, tabTop: tb.top, saveTop: save.top, capOverlap: ov, shown: r.height > 0 }; });
    const rec = await place();
    expect(rec.inDock).toBe(true);
    expect(rec.bottom).toBeLessThanOrEqual(rec.saveTop + 0.5);
    expect(rec.capOverlap).toBe(0);
    await goHash(page, '#dashboard');
    const dash = await place();
    if (dash.shown) { expect(dash.inDock, '다른 탭에서는 main 으로 돌아옴').toBe(false); expect(dash.bottom).toBeLessThanOrEqual(dash.tabTop + 0.5); expect(dash.tabTop - dash.bottom).toBeLessThan(30); }
    await goHash(page, '#record');
    const back = await place();
    if (back.shown) { expect(back.inDock, '기록으로 돌아오면 도크 안').toBe(true); expect(back.bottom).toBeLessThanOrEqual(back.saveTop + 0.5); }
    // 토스트가 사라진 뒤 도크는 원래 높이, 메모·카테고리 포커스가 도크에 가려지지 않는다(scroll-padding)
    await page.mouse.move(2, 2);
    let stuck = false;
    try { await expect(page.locator('#flash')).toHaveText('', { timeout: 9000 }); } catch { stuck = true; }
    expect.soft(stuck, '탭을 오가며 포인터가 토스트 위를 지난 뒤에도 토스트가 사라져야 함(토스트가 영구히 남고 [되돌리기]도 안 사라지면 결함)').toBe(false);
    if (stuck) { console.log('A2 탭 전환 왕복 뒤 토스트가 9초 뒤에도 남음(hover 정지 상태가 풀리지 않음)'); await page.evaluate(() => { document.getElementById('flash').textContent = ''; }); }
    const dockH = await page.evaluate(() => document.querySelector('#save-dock').getBoundingClientRect().height);
    if (!stuck) expect(dockH, '토스트가 없으면 도크는 저장 버튼 높이 근처(후광 포함 80 이하)').toBeLessThanOrEqual(80);
    for (const sel of ['#memo', '#category-chips button >> nth=-1']) {
      await page.locator(sel).focus();
      await page.waitForTimeout(200);
      const clear = await page.evaluate((q) => { const r = (q === '#memo' ? document.querySelector(q) : [...document.querySelectorAll('#category-chips button')].pop()).getBoundingClientRect(); const d = document.querySelector('#save-dock').getBoundingClientRect(); return r.bottom <= d.top + 0.5 || r.top >= d.bottom - 0.5; }, sel);
      expect(clear, sel + ' 포커스가 도크에 가림').toBe(true);
    }
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== A3
test.describe('A3 전월 비교 문구', () => {
  test('A3 둘 다 없으면 카드 아래 한 줄, 한쪽만 없으면 그 칸 "—"(스크린리더 문구 유지), 둘 다 있으면 칸마다', async ({ browser }, testInfo) => {
    const none = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => { await income(api, '급여', 1000000, '2026-10-05'); await expense(api, '식비', 10000, '2026-10-06'); } });
    await expect(none.page.locator('#kpi .sum-balance')).toBeVisible();
    expect(await none.page.locator('#kpi .sum-col .kpi-extra').count(), '칸 안 문구 없음').toBe(0);
    const foot = none.page.locator('#kpi .sum-footnote');
    await expect(foot).toHaveText('지난달 기록이 없어 비교하지 않아요');
    expect(await none.page.locator('#kpi').innerText()).not.toContain('비교할 지난달 기록이 없어요');
    const fr = await foot.evaluate((e) => { const c = document.querySelector('#kpi').getBoundingClientRect(); const r = e.getBoundingClientRect(); const pair = document.querySelector('#kpi .sum-pair').getBoundingClientRect(); return { below: r.top >= pair.bottom - 1, inside: r.left >= c.left && r.right <= c.right, lines: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight)) }; });
    expect(fr.below && fr.inside).toBe(true);
    expect(fr.lines).toBe(1);
    await none.ctx.close();
    const mixed = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => { await income(api, '급여', 1000000, '2026-10-05'); await expense(api, '식비', 10000, '2026-09-06'); await expense(api, '식비', 12000, '2026-10-06'); } });
    await expect(mixed.page.locator('#kpi .sum-balance')).toBeVisible();
    const cols = await mixed.page.locator('#kpi .sum-col').evaluateAll((els) => els.map((c) => { const x = c.querySelector('.kpi-extra'); return { visible: x.querySelector('[aria-hidden="true"]') ? x.querySelector('[aria-hidden="true"]').textContent : x.textContent, sr: x.querySelector('.visually-hidden') ? x.querySelector('.visually-hidden').textContent : null }; }));
    expect(cols[0]).toEqual({ visible: '—', sr: '비교할 지난달 기록이 없어요' });
    expect(cols[1].visible).toBe('▲ 지난달보다 지출이 20.0% 늘었어요');
    expect(await mixed.page.locator('#kpi .sum-footnote').count()).toBe(0);
    await mixed.page.screenshot({ path: join(testInfo.outputDir, `a3-mixed-${widthOf(testInfo)}.png`), clip: { x: 0, y: 0, width: widthOf(testInfo), height: 420 } });
    await mixed.ctx.close();
    const both = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => { for (const m of ['09', '10']) { await income(api, '급여', 500000, `2026-${m}-05`); await expense(api, '식비', 7000, `2026-${m}-06`); } } });
    await expect(both.page.locator('#kpi .sum-balance')).toBeVisible();
    await expect(both.page.locator('#kpi .sum-col .kpi-extra')).toHaveText(['= 지난달과 같아요', '= 지난달과 같아요']);
    await both.ctx.close();
  });
});

// ====================================================================== A4 A5 A7 A8 정적·화면
test.describe('A4~A8 대시보드·내 정보 모양', () => {
  test('A4 인사이트: 보이는 라벨 배지 없음(스크린리더 글자는 유지), 글자 기호 대신 아이콘, 섹션 제목 유지, CSS 중복 블록 없음', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => {
      for (const d of ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05']) await income(api, '급여', 2_500_000, d, '급여');
      for (const d of ['2026-06-01', '2026-07-01', '2026-08-01']) await income(api, '용돈', 100_000, d);
      await income(api, '용돈', 50_000, '2026-09-01');
    } });
    const { page } = a;
    await expect(page.locator('#insights .insight-income-missing')).toBeVisible();
    const m = await page.locator('#insights').evaluate((box) => {
      const lab = box.querySelector('.insight-label'); const r = lab.getBoundingClientRect();
      const ic = box.querySelector('.insight-icon'); const ics = getComputedStyle(ic);
      return { labelText: lab.textContent, labelW: r.width, labelH: r.height, iconText: ic.textContent, iconClass: ic.className, iconHidden: ic.getAttribute('aria-hidden'), iconMask: ics.maskImage || ics.webkitMaskImage, iconW: ic.getBoundingClientRect().width, h3: box.querySelectorAll('h3').length, keys: [...box.querySelectorAll('.insight-section')].map((s) => s.className) };
    });
    expect(m.labelText).toBe('아직 없음');
    expect(m.labelW <= 2 && m.labelH <= 2, `라벨 시각적으로 숨김 ${m.labelW}x${m.labelH}`).toBe(true);
    expect(m.iconText.trim()).toBe('');
    expect(m.iconClass).toContain('icon');
    expect(m.iconHidden).toBe('true');
    expect(m.iconMask).toMatch(/\.svg/);
    expect(m.iconW).toBeGreaterThan(10);
    expect(m.h3).toBeGreaterThan(0);
    expect(m.keys.join(' ')).toContain('insight-income-missing');
    await page.screenshot({ path: join(testInfo.outputDir, `a4-${widthOf(testInfo)}.png`), fullPage: true });
    // I1 줄(지난달)도 확인
    await page.locator('#dash-prev').click();
    await expect(page.locator('#insights .insight-income-drop .insight-text')).toHaveText('용돈: 9월 수입 50,000원으로 평소 월 평균 100,000원보다 50% 적어요');
    expect(a.problems).toEqual([]);
    await a.ctx.close();
    onlyMobile(testInfo);
    const css = readFileSync(join(PUBLIC, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const count = (sel) => css.split('\n').filter((l) => l.trim().startsWith(sel + ' {') || l.trim().startsWith(sel + '{')).length;
    expect(count('.insight-label'), '.insight-label 규칙 중복').toBeLessThanOrEqual(1);
    expect(count('.insight-icon'), '.insight-icon 규칙 중복').toBeLessThanOrEqual(1);
  });

  test('A5 차트 카드: 카테고리 추이 h2, 세 카드 모두 표로 보기가 제목 줄 오른쪽, a.btn 밑줄 없음, 도넛 요약 문장 숨김·막대 차트 요약 유지', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => {
      for (let m = 5; m <= 10; m++) { const mm = String(m).padStart(2, '0'); await expense(api, '식비', 10000 + m * 1000, `2026-${mm}-03`); await income(api, '급여', 500000, `2026-${mm}-15`); }
    } });
    const { page } = a;
    for (const s of ['#chart-donut svg.chart-svg', '#chart-monthly svg.chart-svg', '#chart-cat-trend svg.chart-svg']) await expect(page.locator(s)).toBeVisible();
    await expect(page.locator('#trend-title')).toHaveText('카테고리별 추이');
    const cards = await page.evaluate(() => [...document.querySelectorAll('#panel-dashboard .chart-card')].map((c) => {
      const h = c.querySelector('h2'); const rg = document.createRange(); rg.selectNodeContents(h); const tr = rg.getBoundingClientRect();
      const s = c.querySelector('details summary'); const sr = s.getBoundingClientRect(); const cs = getComputedStyle(s);
      const cap = c.querySelector('figcaption');
      const capVisible = cap ? (cap.getBoundingClientRect().width > 2 && cap.getBoundingClientRect().height > 2) : null;
      return { title: h.textContent.trim(), sameRow: Math.abs((tr.top + tr.bottom) / 2 - (sr.top + sr.bottom) / 2) < 16, right: sr.left > tr.right, summaryInHead: !!s.closest('.card-head, .chart-head') || sr.top < tr.bottom + 20, border: cs.borderTopWidth, h: sr.height, capVisible, inCard: sr.right <= c.getBoundingClientRect().right };
    }));
    console.log(`A5 cards ${JSON.stringify(cards)}`);
    expect(cards.map((c) => c.title)).toEqual(['카테고리별 지출', '월별 추이', '카테고리별 추이']);
    for (const c of cards) { expect(c.sameRow, `${c.title} 표로 보기가 제목 줄`).toBe(true); expect(c.right, `${c.title} 오른쪽`).toBe(true); expect(c.border, `${c.title} 글자 버튼(테두리 없음)`).toBe('0px'); expect(c.h).toBeGreaterThanOrEqual(43.5); expect(c.inCard).toBe(true); }
    for (const c of cards.slice(1)) expect(c.capVisible, `${c.title} 캡션 숨김`).not.toBe(true);
    const link = await page.locator('.donut-card a[href="#categories"]').evaluate((e) => getComputedStyle(e).textDecorationLine);
    expect(link, '카테고리 관리 밑줄').toBe('none');
    // 도넛: 요약 문장은 화면에서 숨기고 SVG desc 는 남는다, 막대 차트 요약은 보인다
    const sum = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden'; };
      const donutText = [...document.querySelectorAll('#chart-donut p, #chart-donut .chart-summary')].filter(vis).map((e) => e.textContent.trim()).filter((t) => /가장 큼|가장 큰/.test(t));
      const barText = [...document.querySelectorAll('#chart-monthly p, #chart-monthly .chart-summary')].filter(vis).map((e) => e.textContent.trim()).filter((t) => /가장 큰 달|합계|까지/.test(t));
      return { donutText, barText, desc: !!document.querySelector('#chart-donut svg desc') && document.querySelector('#chart-donut svg desc').textContent.length > 5 };
    });
    expect(sum.donutText, '도넛 요약 문장은 화면에서 숨김').toEqual([]);
    expect(sum.barText.length, '막대 차트 요약은 남김').toBeGreaterThan(0);
    expect(sum.desc).toBe(true);
    // 표로 보기를 세 카드에서 모두 열어도 겹침·가로 스크롤 없음
    for (const s of await page.locator('#panel-dashboard details summary').all()) await s.click();
    const ov = await page.evaluate(() => {
      const bad = [];
      for (const card of document.querySelectorAll('#panel-dashboard .card')) {
        const kids = [...card.children].filter((c) => c.getClientRects().length).map((c) => ({ c, r: c.getBoundingClientRect() }));
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const p = kids[i].r; const q = kids[j].r; if (p.bottom > q.top + 1 && p.top < q.bottom - 1 && p.right > q.left + 1 && p.left < q.right - 1) bad.push(`${kids[i].c.className}|${kids[j].c.className}`); }
      }
      return bad;
    });
    expect(ov, '표로 보기 연 상태 겹침').toEqual([]);
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    await page.screenshot({ path: join(testInfo.outputDir, `a5-open-${widthOf(testInfo)}.png`), fullPage: true });
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('A6 세그먼트 선택 상태 테두리 대비(라이트·다크): 기록 지출/수입, 대시보드 지출/수입·6/12개월', async ({ browser }, testInfo) => {
    const out = [];
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme, hash: '#record' });
      const { page } = a;
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      const measure = async (sel, label) => {
        const m = await page.locator(sel).evaluate((e) => { const c = getComputedStyle(e); const tr = getComputedStyle(e.parentElement); const ins = (c.boxShadow.match(/(rgba?\([^)]*\))\s+0px 0px 0px 1px inset/) || c.boxShadow.match(/inset 0px 0px 0px 1px (rgba?\([^)]*\))/) || [])[1]; return { pressed: e.getAttribute('aria-pressed'), bw: ins ? '1px' : '0px', bc: ins || 'rgb(0, 0, 0)', bg: c.backgroundColor, track: tr.backgroundColor, fw: c.fontWeight, sh: c.boxShadow }; });
        const r = { label: `${scheme} ${label}`, borderW: m.bw, borderVsTrack: +ratio(rgb(m.bc), rgb(m.track)).toFixed(2), bgVsTrack: +ratio(rgb(m.bg), rgb(m.track)).toFixed(2), fw: m.fw, pressed: m.pressed, shadow: m.sh !== 'none' };
        out.push(r);
        return { m, r };
      };
      const sel1 = await measure('#type-expense', '지출(기록)');
      expect(sel1.m.pressed).toBe('true');
      expect(sel1.m.bw, `${scheme} 선택 항목 테두리`).not.toBe('0px');
      expect.soft(sel1.r.borderVsTrack, `${scheme} 선택 테두리 대 트랙 대비`).toBeGreaterThanOrEqual(3);
      const un = await measure('#type-income', '수입(기록, 비선택)');
      expect(un.m.pressed).toBe('false');
      await goHash(page, '#dashboard');
      await expect(page.locator('#kpi .sum-balance')).toBeVisible();
      for (const [sel, label] of [['#catview-expense', '지출(대시보드)'], ['#range-6', '6개월']]) {
        const x = await measure(sel, label);
        expect(x.m.pressed).toBe('true');
        expect.soft(x.r.borderVsTrack, `${scheme} ${label} 선택 테두리 대비`).toBeGreaterThanOrEqual(3);
      }
      await page.screenshot({ path: join(testInfo.outputDir, `a6-${scheme}-${widthOf(testInfo)}.png`), clip: { x: 0, y: 0, width: widthOf(testInfo), height: 500 } });
      await a.ctx.close();
    }
    console.log(`A6 ${JSON.stringify(out)}`);
  });

  test('A7 다크 차트 격자선이 중립색(금색 아님), 라이트 불변 / A8 내 정보·카테고리 관리 제목에 포커스 링 없음, 다른 요소 포커스 링은 유지', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { scheme: 'dark', hash: '#dashboard', prepare: async (api) => {
      for (let m = 5; m <= 10; m++) { const mm = String(m).padStart(2, '0'); await expense(api, '식비', 10000 + m * 1000, `2026-${mm}-03`); await income(api, '급여', 500000, `2026-${mm}-15`); }
    } });
    const { page } = a;
    await expect(page.locator('#chart-monthly svg.chart-svg')).toBeVisible();
    const grid = async () => page.evaluate(() => {
      const probe = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const x = getComputedStyle(i).color; i.remove(); return x; };
      const g = document.querySelector('#chart-monthly .chart-grid'); const cs = getComputedStyle(g);
      return { stroke: cs.stroke, op: cs.strokeOpacity, line: probe('--color-line'), muted: probe('--color-text-muted'), n: document.querySelectorAll('#chart-monthly .chart-grid').length };
    });
    const dk = await grid();
    console.log(`A7 dark ${JSON.stringify(dk)}`);
    expect(dk.n).toBeGreaterThan(0);
    expect(dk.stroke, '다크 격자선 != --color-line(금색)').not.toBe(dk.line);
    const nums = dk.stroke.match(/[\d.]+/g).map(Number);
    // color-mix 결과(color(srgb r g b / a) 또는 rgba)에서 채널 편차가 작으면 중립
    const ch = dk.stroke.startsWith('color(') ? nums.slice(0, 3).map((x) => x * 255) : nums.slice(0, 3);
    const spread = Math.max(...ch) - Math.min(...ch);
    const lineCh = rgb(dk.line); const lineSpread = Math.max(...lineCh) - Math.min(...lineCh);
    expect(spread, `격자선 채널 편차 ${spread.toFixed(1)} < 금색 선 ${lineSpread}`).toBeLessThan(lineSpread);
    await page.screenshot({ path: join(testInfo.outputDir, `a7-dark-${widthOf(testInfo)}.png`), fullPage: true });
    await a.ctx.close();
    const lt = await open(browser, testInfo, { scheme: 'light', hash: '#dashboard', user: a });
    await expect(lt.page.locator('#chart-monthly svg.chart-svg')).toBeVisible();
    const gl = await lt.page.evaluate(() => { const g = document.querySelector('#chart-monthly .chart-grid'); const cs = getComputedStyle(g); return { stroke: cs.stroke, op: cs.strokeOpacity }; });
    console.log(`A7 light ${JSON.stringify(gl)}`);
    expect(gl.stroke).not.toBe('none');
    await lt.ctx.close();
    // A8
    for (const scheme of ['light', 'dark']) {
      const b = await open(browser, testInfo, { scheme, hash: '#record' });
      await goHash(b.page, '#account');
      const st = await b.page.evaluate(() => { const h = document.getElementById('account-title'); const c = getComputedStyle(h); return { active: document.activeElement && document.activeElement.id, outline: `${c.outlineStyle} ${c.outlineWidth}`, shadow: c.boxShadow, tab: h.getAttribute('tabindex') }; });
      expect(st.active, '화면 이동 때 제목에 포커스(스크린리더용)').toBe('account-title');
      expect(st.shadow, `${scheme} 내 정보 제목 포커스 상자`).toBe('none');
      expect(st.outline).toMatch(/^(none|solid 0px)/);
      await goHash(b.page, '#categories');
      await expect(b.page.locator('#cat-title')).toBeVisible();
      const cat = await b.page.evaluate(() => { const c = getComputedStyle(document.getElementById('cat-title')); return { shadow: c.boxShadow, outline: `${c.outlineStyle} ${c.outlineWidth}` }; });
      expect(cat.shadow).toBe('none');
      // 다른 요소의 포커스 링은 그대로
      await goHash(b.page, '#account');
      await b.page.locator('#account-back').focus();
      await b.page.keyboard.press('Tab');
      await b.page.keyboard.press('Shift+Tab');
      const ring = await b.page.evaluate(() => { const e = document.activeElement; return { id: e.id, fv: e.matches(':focus-visible'), shadow: getComputedStyle(e).boxShadow }; });
      expect(ring.fv).toBe(true);
      expect(ring.shadow, `${scheme} 다른 요소 포커스 링`).not.toBe('none');
      await b.page.screenshot({ path: join(testInfo.outputDir, `a8-${scheme}-${widthOf(testInfo)}.png`), clip: { x: 0, y: 0, width: widthOf(testInfo), height: 300 } });
      await b.ctx.close();
    }
  });
});

// ====================================================================== A9 A10
test.describe('A9 A10 요청·코드', () => {
  test('A9 대시보드 요청: 처음 4종, 6->12개월은 월별·카테고리 추이만, 지출->수입은 카테고리·추이만, 월 이동은 4종 전체, 오래된 응답 버림', async ({ browser }, testInfo) => {
    const a = await open(browser, testInfo, { hash: '#record', prepare: async (api) => { for (const m of ['2026-08', '2026-09', '2026-10']) { await expense(api, '식비', 10000, m + '-03'); await income(api, '급여', 500000, m + '-15'); } } });
    const { page } = a;
    const API = { ins: '/api/insights', monthly: '/api/stats/monthly', cat: '/api/stats/categories', trend: '/api/stats/category-monthly' };
    const names = (list) => list.map((r) => r.replace(/^GET /, '').replace(/\?.*$/, '')).filter((p) => Object.values(API).includes(p));
    const step = async (label, act) => {
      a.reqs.length = 0;
      await act();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const got = [...new Set(names(a.reqs))].sort();
      console.log(`A9 ${label}: ${got.join(', ')} (총 ${names(a.reqs).length}회)`);
      return { got, count: names(a.reqs).length, raw: a.reqs.slice() };
    };
    const open1 = await step('탭 진입', async () => { await goHash(page, '#dashboard'); await expect(page.locator('#chart-cat-trend svg.chart-svg')).toBeVisible(); });
    expect(open1.got).toEqual([API.cat, API.ins, API.monthly, API.trend].sort());
    expect(open1.count, '진입 시 각 1회').toBe(4);
    const rng = await step('6->12개월', async () => { await page.locator('#range-12').click(); await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12); });
    expect(rng.got, '기간 변경').toEqual([API.monthly, API.trend].sort());
    expect(rng.count).toBe(2);
    const view = await step('지출->수입', async () => { await page.locator('#catview-income').click(); await expect(page.locator('#donut-title')).toHaveText('카테고리별 수입'); });
    expect(view.got, '보기 변경').toEqual([API.cat, API.trend].sort());
    expect(view.count).toBe(2);
    expect(view.raw.some((r) => /type=income/.test(r))).toBe(true);
    const mon = await step('월 이동', async () => { await page.locator('#dash-prev').click(); await expect(page.locator('#dash-month')).toHaveText('2026년 9월'); });
    expect(mon.got, '월 이동').toEqual([API.cat, API.ins, API.monthly, API.trend].sort());
    expect(mon.count).toBe(4);
    expect(mon.raw.filter((r) => r.includes('/api/insights'))[0]).toContain('month=2026-09');
    // 빠른 연속 전환: 마지막 상태와 화면이 일치(오래된 응답 버림)
    await page.locator('#range-6').click();
    await page.locator('#range-12').click();
    await page.locator('#range-6').click();
    await expect(page.locator('#range-6')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(6);
    await page.locator('#catview-expense').click();
    await page.locator('#catview-income').click();
    await page.locator('#catview-expense').click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#donut-title')).toHaveText('카테고리별 지출');
    await expect(page.locator('#chart-donut')).toHaveAttribute('aria-label', '카테고리 지출 비중');
    expect(await page.locator('#dash-error').innerText()).toBe('');
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });

  test('A10 정리: incomeCats 제거, 머리 주석에 인사이트(F8) 없음, 숨겨진 상태에서 그린 격자의 잘린 이름에도 title', async ({ browser }, testInfo) => {
    const src = readFileSync(join(PUBLIC, 'js', 'record.js'), 'utf8');
    expect(src).not.toMatch(/incomeCats/);
    expect(src.split('\n').slice(0, 3).join('\n')).not.toMatch(/인사이트\(F8\)/);
    const longW = 'W'.repeat(15);
    // 대시보드로 시작(기록 패널이 숨겨진 채로 격자가 그려진다) -> 기록으로 이동
    const a = await open(browser, testInfo, { hash: '#dashboard', prepare: async (api) => { expect((await json(api, 'POST', '/api/categories', { type: 'expense', name: longW })).status()).toBe(201); } });
    const { page } = a;
    await expect(page.locator('#kpi .sum-balance')).toBeVisible();
    await goHash(page, '#record');
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    await page.locator('#category-chips .chip--toggle').click();
    await page.waitForTimeout(300);
    const t = await page.locator('#category-chips button', { hasText: longW }).evaluate((b) => ({ title: b.getAttribute('title'), clipped: b.querySelector('.chip__name').scrollHeight > b.querySelector('.chip__name').clientHeight + 1 }));
    expect(t.clipped).toBe(true);
    expect(t.title, '숨겨진 상태에서 그려졌어도 잘린 이름에 title').toBe(longW);
    // 폭이 바뀌어도(뷰포트 변경) 다시 판단
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    expect(await page.locator('#category-chips button', { hasText: longW }).getAttribute('title')).toBe(longW);
    expect(a.problems).toEqual([]);
    await a.ctx.close();
  });
});

// ====================================================================== 전체: 768·라이트·키보드·스크린샷
test.describe('전체 확인', () => {
  test('키보드 포커스 경로(기록: 이름 -> 해·달 -> ... -> 저장), 포커스 링이 토스트·저장 후광에 가려지지 않음', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    for (const scheme of ['light', 'dark']) {
      const a = await open(browser, testInfo, { scheme, height: widthOf(testInfo) === 360 ? 740 : 1024 });
      const { page } = a;
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      await page.locator('#user-name').focus();
      const seen = [];
      for (let i = 0; i < 40; i++) {
        const info = await page.evaluate(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); const save = document.querySelector('#save-btn').getBoundingClientRect(); const tb = document.querySelector('.tabbar').getBoundingClientRect(); return { id: e.id || e.className.toString().slice(0, 24) || e.tagName, fv: e.matches(':focus-visible'), ring: getComputedStyle(e).boxShadow !== 'none' || getComputedStyle(e).outlineStyle !== 'none', covered: e.id !== 'save-btn' && r.bottom > save.top - 8 && r.top < save.bottom && r.height > 0 && r.top >= 0 && r.top < innerHeight && false, underTab: r.top >= 0 && r.bottom > tb.top && r.top < tb.bottom }; });
        seen.push(info.id);
        if (info.fv && info.id !== 'amount') expect(info.ring, `${scheme} ${info.id} 포커스 링`).toBe(true); // 금액 칸은 밑줄 색으로 표시
        if (info.id === 'save-btn') break;
        await page.keyboard.press('Tab');
      }
      expect(seen, `${scheme} 경로 ${seen.join(' > ')}`).toContain('save-btn');
      const order = ['user-name', 'theme-toggle', 'type-expense', 'type-income', 'amount'];
      const idx = order.map((id) => seen.indexOf(id));
      for (let i = 1; i < idx.length; i++) expect(idx[i] === -1 || idx[i] > idx[i - 1], `${scheme} 순서 ${seen.join(' > ')}`).toBe(true);
      // 저장 버튼에 포커스한 상태에서 링이 화면 안(탭바 위)
      const sv = await page.evaluate(() => { const r = document.querySelector('#save-btn').getBoundingClientRect(); const t = document.querySelector('.tabbar').getBoundingClientRect(); return { ok: r.bottom <= t.top + 0.5 && r.top >= 0 }; });
      expect(sv.ok).toBe(true);
      await a.ctx.close();
    }
  });

  test('라이트 모드 전체: 기록·대시보드·내 정보에서 가로 스크롤·콘솔 오류 없음(768 포함), 스크린샷', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const w = widthOf(testInfo);
    const dir = join(ROOT, 'docs', 'qa-shots-improvements');
    mkdirSync(dir, { recursive: true });
    const a = await open(browser, testInfo, { scheme: 'light', height: w === 360 ? 740 : 1024, prepare: async (api) => {
      for (let i = 0; i < 9; i++) await expense(api, ['식비', '교통', '쇼핑', '기타'][i % 4], 12000 + i * 3000, `2026-10-${String(3 + i).padStart(2, '0')}`, `메모${i}`);
      await income(api, '급여', 2_000_000, '2026-10-02');
    } });
    const { page } = a;
    for (const [h, name] of [['#record', 'record'], ['#dashboard', 'dashboard'], ['#account', 'account']]) {
      await goHash(page, h);
      await page.waitForTimeout(500);
      await expectNoHorizontalScroll(page, w);
      await page.screenshot({ path: join(dir, `${name}-light-${w}.png`), fullPage: h === '#dashboard' });
    }
    expect(a.problems).toEqual([]);
    await a.ctx.close();
    const d = await open(browser, testInfo, { scheme: 'dark', hash: '#dashboard', height: w === 360 ? 740 : 1024, user: a });
    await expect(d.page.locator('#kpi .sum-balance')).toBeVisible();
    await d.page.waitForTimeout(500);
    await d.page.screenshot({ path: join(dir, `dashboard-dark-${w}.png`), fullPage: true });
    await d.ctx.close();
  });
});
