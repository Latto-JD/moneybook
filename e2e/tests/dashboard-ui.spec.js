// plan 9.7 대시보드 UI (C32 일부, C62~C67). 360px / 768px 프로젝트에서 실행.
// 셀렉터: #dash-prev #dash-next #dash-month #range-6 #range-12 #dash-error #kpi .kpi #chart-donut #chart-monthly #cat-trend-chips #chart-cat-trend, 각 차트의 details("표로 보기")
// UI "오늘"은 브라우저 시각 -> ctx.clock 으로 2026-10-19 고정 (시드 today 와 동일). 시드 사용자는 서버 시작 전에 seed.js 로 생성(SEED_*).
import { test, expect } from '@playwright/test';
import { newApi, json, get, createLoggedInUser, addTx } from '../helpers/api.js';
import { newUiPage, expectNoBadNumbers, expectNoHorizontalScroll, fmtWon, FIXED_TODAY } from '../helpers/ui.js';
import { SEED_EMAIL, SEED_PASSWORD, SEED_TODAY } from '../helpers/env.js';

const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const NO_PREV = '비교할 지난달 기록이 없어요';
const EMPTY = '아직 이 기간에 기록이 없어요';

async function seedApi() {
  const api = await newApi();
  const r = await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD });
  expect(r.status(), await r.text()).toBe(200);
  return api;
}
const stat = async (api, path) => (await get(api, `/api/stats/${path}`)).json();

/** 표(details 안, 닫혀 있어도 DOM 에 존재) 행 -> [[head, ...cells]] (textContent 사용) */
const tableRows = (loc) => loc.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
const tableFoot = (loc) => loc.locator('table tfoot tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
const monthTitleOf = (ym) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
const shiftYm = (ym, d) => { const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

async function openSeedDashboard(browser, testInfo) {
  const api = await seedApi();
  const ui = await newUiPage(browser, testInfo, { api });
  await ui.page.goto('/#dashboard');
  await expect(ui.page.locator('#dash-month')).toHaveText('2026년 10월');
  await expect(ui.page.locator('#chart-donut figure')).toBeVisible();
  return { ...ui, api };
}

test.describe('시드 환경 확인', () => {
  test('SEED_* 환경변수 필요 (없으면 C62~C65 는 skip 되어 "미실행")', async () => {
    test.skip(!(SEED_EMAIL && SEED_PASSWORD && SEED_TODAY), 'SEED_EMAIL/SEED_PASSWORD/SEED_TODAY 미지정');
    expect(SEED_TODAY).toBe(FIXED_TODAY); // UI 시각 고정값과 시드 today 가 같아야 기준 월이 일치
  });
});

test.describe('C66 신규 사용자 빈 상태', () => {
  test('C66 차트 대신 빈 상태 문구, NaN/undefined/Infinity 없음, "비교할 지난달 기록이 없어요"', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('c66');
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#dashboard');
    await expect(page.locator('#dash-month')).toHaveText('2026년 10월');
    await expect(page.locator('#chart-donut .chart-empty')).toHaveText(EMPTY);
    await expect(page.locator('#chart-monthly .chart-empty')).toHaveText(EMPTY);
    await expect(page.locator('#chart-cat-trend .chart-empty')).toHaveText(EMPTY);
    expect(await page.locator('#chart-donut svg, #chart-monthly svg, #chart-cat-trend svg').count()).toBe(0);
    await expect(page.locator('#kpi')).toContainText(NO_PREV);
    await expect(page.locator('#kpi .kpi')).toHaveCount(3);
    await expectNoBadNumbers(page);
    await page.locator('#range-12').click();
    await expect(page.locator('#range-12')).toHaveAttribute('aria-pressed', 'true');
    await expectNoBadNumbers(page);
    await expect(page.locator('#dash-error')).toHaveText('');
    await ctx.close();
  });
});

test.describe('C32 대시보드 가로 스크롤/터치 영역', () => {
  test('C32 대시보드 탭(6/12개월 선택) scrollWidth <= viewport, 주요 버튼 44x44 이상', async ({ browser }, testInfo) => {
    test.skip(!SEED_EMAIL, 'SEED_EMAIL 필요');
    const { ctx, page } = await openSeedDashboard(browser, testInfo);
    const w = widthOf(testInfo);
    await expectNoHorizontalScroll(page, w);
    await page.locator('#range-12').click();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
    await expectNoHorizontalScroll(page, w);
    // 표를 모두 펼친 상태에서도 가로 스크롤 없음
    for (const s of await page.locator('details.chart-table summary').all()) await s.click();
    await expectNoHorizontalScroll(page, w);
    const small = await page.evaluate(() => {
      const out = [];
      for (const sel of ['#dash-prev', '#dash-next', '#range-6', '#range-12', '#cat-trend-chips button', '#tab-record', '#tab-dashboard', '#logout-btn', 'details.chart-table summary']) {
        document.querySelectorAll(sel).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 43.99 || r.height < 43.99) out.push(`${sel} "${el.textContent.trim().slice(0, 10)}" ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
        });
      }
      return out;
    });
    expect(small, JSON.stringify(small)).toEqual([]);
    await ctx.close();
  });
  test('C32 신규 사용자(빈 상태) 대시보드도 가로 스크롤 없음', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('c32empty');
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut .chart-empty')).toBeVisible();
    await page.locator('#range-12').click();
    await expectNoHorizontalScroll(page, widthOf(testInfo));
    await ctx.close();
  });
});

test.describe('시드 사용자 대시보드 (C62~C65)', () => {
  test.skip(!(SEED_EMAIL && SEED_PASSWORD && SEED_TODAY), 'SEED_* 미지정');

  test('C62 KPI 수입/지출/잔액, 전월 대비 문구가 stats/monthly 와 일치', async ({ browser }, testInfo) => {
    const { ctx, page, api } = await openSeedDashboard(browser, testInfo);
    const m = await stat(api, 'monthly?from=2026-05&to=2026-10');
    const cur = m.months.find((x) => x.month === '2026-10');
    const prev = m.months.find((x) => x.month === '2026-09');
    const kpis = await page.locator('#kpi .kpi').evaluateAll((els) => els.map((e) => ({
      label: e.querySelector('.kpi-label').textContent.trim(), value: e.querySelector('.kpi-value').textContent.trim(),
      extra: e.querySelector('.kpi-extra')?.textContent.trim() || '',
    })));
    expect(kpis.map((k) => k.label)).toEqual(['수입', '지출', '잔액']);
    expect(kpis[0].value).toBe(fmtWon(cur.incomeTotal));
    expect(kpis[1].value).toBe(fmtWon(cur.expenseTotal));
    expect(kpis[2].value).toBe(fmtWon(cur.balance));
    expect(cur.balance).toBe(cur.incomeTotal - cur.expenseTotal);
    const pct = (Math.round((Math.abs(cur.expenseTotal - prev.expenseTotal) / prev.expenseTotal) * 1000) / 10).toFixed(1);
    const more = cur.expenseTotal > prev.expenseTotal;
    expect(kpis[1].extra).toBe(`${more ? '▲' : '▼'} 지난달보다 ${pct}% ${more ? '더 썼어요' : '덜 썼어요'}`);
    await expectNoBadNumbers(page);
    await ctx.close();
  });

  test('C62 도넛 범례(카테고리·금액·%) 와 표가 stats/categories 와 일치, 비율 소수 첫째 자리', async ({ browser }, testInfo) => {
    const { ctx, page, api } = await openSeedDashboard(browser, testInfo);
    const c = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    const legend = await page.locator('#chart-donut .legend li').evaluateAll((lis) => lis.map((li) => ({
      label: li.querySelector('.legend-label').textContent.trim(),
      amount: li.querySelector('.legend-amount').textContent.trim(),
      ratio: li.querySelector('.legend-ratio').textContent.trim(),
    })));
    expect(legend.map((l) => l.label)).toEqual(c.items.map((i) => i.category));
    expect(legend.map((l) => l.amount)).toEqual(c.items.map((i) => fmtWon(i.total)));
    expect(legend.map((l) => l.ratio)).toEqual(c.items.map((i) => `${((i.total / c.grandTotal) * 100).toFixed(1)}%`));
    for (const l of legend) expect(l.ratio).toMatch(/^\d+\.\d%$/);
    // API ratio(4자리 반올림) 기반 값과도 일치하는지 (불일치 시 관찰사항)
    const viaApiRatio = c.items.map((i) => `${(i.ratio * 100).toFixed(1)}%`);
    if (JSON.stringify(viaApiRatio) !== JSON.stringify(legend.map((l) => l.ratio))) {
      test.info().annotations.push({ type: 'observation', description: `API ratio 반올림 기준과 1자리 % 가 다름: ${JSON.stringify(viaApiRatio)} vs ${JSON.stringify(legend.map((l) => l.ratio))}` });
    }
    // 가운데 총지출, 표, 합계 행
    await expect(page.locator('#chart-donut svg text').filter({ hasText: fmtWon(c.grandTotal) })).toHaveCount(1);
    const rows = await tableRows(page.locator('#chart-donut'));
    expect(rows).toEqual(c.items.map((i) => [i.category, fmtWon(i.total), `${((i.total / c.grandTotal) * 100).toFixed(1)}%`]));
    expect((await tableFoot(page.locator('#chart-donut')))[0]).toEqual(['합계', fmtWon(c.grandTotal), '100.0%']);
    await ctx.close();
  });

  test('C62 월별 추이 표(수입/지출/잔액)와 카테고리 추이 표가 stats API 와 일치 (6개월)', async ({ browser }, testInfo) => {
    const { ctx, page, api } = await openSeedDashboard(browser, testInfo);
    const m = await stat(api, 'monthly?from=2026-05&to=2026-10');
    expect(await tableRows(page.locator('#chart-monthly'))).toEqual(
      m.months.map((x) => [monthTitleOf(x.month), fmtWon(x.incomeTotal), fmtWon(x.expenseTotal), fmtWon(x.balance)]));
    const cm = await stat(api, 'category-monthly?from=2026-05&to=2026-10&type=expense');
    const c = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    // 기본 선택 카테고리 = 기준 월 지출 1위
    const top = c.items[0].category;
    await expect(page.locator('#cat-trend-chips button[aria-pressed="true"]')).toHaveText(new RegExp(top));
    const s = cm.series.find((x) => x.category === top);
    expect(await tableRows(page.locator('#chart-cat-trend'))).toEqual(cm.months.map((mm, i) => [monthTitleOf(mm), fmtWon(s.totals[i])]));
    expect((await tableFoot(page.locator('#chart-cat-trend')))[0]).toEqual(['합계', fmtWon(s.sum)]);
    // 칩 목록 = series 순서(sum 내림차순)
    const chipTexts = (await page.locator('#cat-trend-chips button').allTextContents()).map((t) => t.replace(/^\s*✓?\s*/, '').trim());
    expect(chipTexts).toEqual(cm.series.map((x) => x.category));
    await ctx.close();
  });

  test('C63 접근성: figure·svg role=img+이름·table(caption, th[scope]), 범례 텍스트, 도넛 범례 금액 내림차순, 수입/지출 fill 구분', async ({ browser }, testInfo) => {
    const { ctx, page } = await openSeedDashboard(browser, testInfo);
    for (const id of ['#chart-donut', '#chart-monthly', '#chart-cat-trend']) {
      const box = page.locator(id);
      await expect(box.locator('figure'), `${id} figure`).toHaveCount(1);
      await expect(box.locator('figure > figcaption')).toHaveText(/./);
      const svg = box.locator('svg[role="img"]');
      await expect(svg, `${id} svg[role=img]`).toHaveCount(1);
      await expect(svg).toHaveAccessibleName(/./);
      // 이름 = <title> + <desc>(요약 문장) (aria-labelledby 두 요소)
      const nm = await svg.evaluate((e) => e.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent || '').join(' | '));
      expect(nm.split(' | ').every((x) => x.length > 3), nm).toBe(true);
      const t = box.locator('table');
      await expect(t, `${id} table`).toHaveCount(1);
      await expect(t.locator('caption')).toHaveText(/./);
      const noScope = await t.locator('th').evaluateAll((ths) => ths.filter((th) => !th.getAttribute('scope')).length);
      expect(noScope, `${id} scope 없는 th`).toBe(0);
      // 표로 보기 details: summary 클릭하면 표가 보인다
      const det = box.locator('details');
      await expect(det.locator('summary')).toHaveText('표로 보기');
      await expect(t).toBeHidden();
      await det.locator('summary').click();
      await expect(t).toBeVisible();
    }
    // 도넛 요약 문장
    await expect(page.locator('#chart-donut svg[role="img"] desc')).toHaveText(/^2026년 10월 지출 [\d,]+원 중 .+ \d+\.\d%로 가장 큼$/);
    // 범례: 수입/지출 텍스트
    const legendText = await page.locator('#chart-monthly .legend').innerText();
    expect(legendText).toContain('수입');
    expect(legendText).toContain('지출');
    // 도넛 범례: 카테고리명·금액·% 텍스트 + 금액 내림차순
    const items = await page.locator('#chart-donut .legend li').evaluateAll((lis) => lis.map((li) => [
      li.querySelector('.legend-label')?.textContent.trim() || '', li.querySelector('.legend-amount')?.textContent.trim() || '', li.querySelector('.legend-ratio')?.textContent.trim() || '']));
    expect(items.length).toBeGreaterThan(1);
    const amounts = [];
    for (const [label, amount, ratio] of items) {
      expect(label).toMatch(/^[가-힣/]+$/);
      expect(amount).toMatch(/^[0-9,]+원$/);
      expect(ratio).toMatch(/^[0-9]+[.][0-9]%$/);
      amounts.push(Number(amount.replace(/[^0-9]/g, '')));
    }
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    // 도넛 조각 순서 = 범례 순서: 조각 수 = 범례 수, 각 조각 fill 서로 다름(무늬/색)
    const segFills = await page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => p.getAttribute('fill')));
    expect(segFills).toHaveLength(items.length);
    expect(new Set(segFills).size).toBe(segFills.length);
    // 수입/지출 막대 fill: 서로 다르고 하나는 url(#...) 패턴
    const barFills = await page.locator('#chart-monthly svg.chart-svg > rect').evaluateAll((rs) => [...new Set(rs.map((r) => r.getAttribute('fill')))]);
    expect(barFills).toHaveLength(2);
    expect(barFills.filter((f) => /^url\(#.+\)$/.test(f))).toHaveLength(1);
    expect(barFills.filter((f) => !/^url\(#/.test(f))).toHaveLength(1);
    const patId = barFills.find((f) => f.startsWith('url(')).slice(5, -1);
    expect(await page.locator(`#chart-monthly svg pattern[id="${patId}"]`).count()).toBeGreaterThan(0);
    // 범례 견본(swatch)도 같은 구분: 수입 = 패턴, 지출 = 단색
    const sw = await page.locator('#chart-monthly .legend li svg rect').evaluateAll((rs) => rs.map((r) => r.getAttribute('fill')));
    expect(sw).toHaveLength(2);
    expect(sw[0]).toMatch(/^url\(#/);
    expect(sw[1]).not.toMatch(/^url\(#/);
    await ctx.close();
  });

  test('C64 360px: 축/범례 텍스트 렌더링 높이 >= 11px (6개월·12개월)', async ({ browser }, testInfo) => {
    test.skip(widthOf(testInfo) !== 360, 'C64 는 360px 항목 (768 프로젝트에서는 참고용으로 측정만 하지 않음)');
    const { ctx, page } = await openSeedDashboard(browser, testInfo);
    const measure = () => page.evaluate(() => {
      const res = { texts: [], legend: [] };
      for (const t of document.querySelectorAll('#chart-donut svg text, #chart-monthly svg text, #chart-cat-trend svg text')) {
        const r = t.getBoundingClientRect();
        const svg = t.ownerSVGElement;
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        res.texts.push({ s: t.textContent, h: r.height, fontPx: parseFloat(getComputedStyle(t).fontSize) * scale });
      }
      for (const li of document.querySelectorAll('.legend li .legend-label, .legend li .legend-amount, .legend li .legend-ratio')) {
        res.legend.push({ s: li.textContent, h: li.getBoundingClientRect().height, fontPx: parseFloat(getComputedStyle(li).fontSize) });
      }
      return res;
    });
    for (const range of [6, 12]) {
      if (range === 12) { await page.locator('#range-12').click(); await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12); }
      const r = await measure();
      expect(r.texts.length).toBeGreaterThan(5);
      const low = r.texts.filter((t) => !(t.h >= 11));
      const lowFont = r.texts.filter((t) => !(t.fontPx >= 11));
      test.info().annotations.push({
        type: `C64-${range}m`,
        description: `svg text ${r.texts.length}개 min(rect.height)=${Math.min(...r.texts.map((t) => t.h)).toFixed(2)} min(렌더 font px)=${Math.min(...r.texts.map((t) => t.fontPx)).toFixed(2)}; 범례 ${r.legend.length}개 min height=${Math.min(...r.legend.map((t) => t.h)).toFixed(2)}`,
      });
      expect(low, `rect 높이 < 11: ${JSON.stringify(low.slice(0, 5))}`).toEqual([]);
      expect(r.legend.filter((t) => !(t.h >= 11))).toEqual([]);
      // 보조 기준: 렌더링된 글자 크기(font-size x 축소비)도 11px 이상인지 (참고, 별도 보고)
      expect.soft(lowFont, `렌더 font px < 11: ${JSON.stringify(lowFont.slice(0, 3))}`).toEqual([]);
    }
    await ctx.close();
  });

  test('C64 월 레이블: 12개월 선택 시 "N월" 형식, 겹치면 격월(표에는 전체 12행)', async ({ browser }, testInfo) => {
    const { ctx, page } = await openSeedDashboard(browser, testInfo);
    await page.locator('#range-12').click();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
    const labels = await page.locator('#chart-monthly svg.chart-svg > text').allTextContents();
    const monthLabels = labels.filter((t) => /^\d{1,2}월$/.test(t));
    expect(monthLabels.length).toBeGreaterThan(0);
    expect(monthLabels.length).toBeLessThanOrEqual(12);
    test.info().annotations.push({ type: 'month-labels-12', description: monthLabels.join(',') });
    // 겹치지 않는지: 레이블 사각형끼리 교차 없음
    const overlap = await page.evaluate(() => {
      const ts = [...document.querySelectorAll('#chart-monthly svg.chart-svg > text')].filter((t) => /^\d{1,2}월$/.test(t.textContent)).map((t) => t.getBoundingClientRect());
      for (let i = 1; i < ts.length; i++) if (ts[i].left < ts[i - 1].right - 0.5) return true;
      return false;
    });
    expect(overlap).toBe(false);
    await ctx.close();
  });

  test('C65 기준 월 이동·6/12개월 전환·카테고리 칩 선택이 새로고침 없이 차트와 표를 갱신 (12개월 표 12행)', async ({ browser }, testInfo) => {
    const { ctx, page, api } = await openSeedDashboard(browser, testInfo);
    await page.evaluate(() => { window.__qaMarker = 42; });
    const kpiText = () => page.locator('#kpi').innerText();
    const k0 = await kpiText();

    // 이전 달
    await page.locator('#dash-prev').click();
    await expect(page.locator('#dash-month')).toHaveText('2026년 9월');
    const sep = (await stat(api, 'monthly?from=2026-09&to=2026-09')).months[0];
    await expect(page.locator('#kpi .kpi-value').nth(1)).toHaveText(fmtWon(sep.expenseTotal));
    expect(await kpiText()).not.toBe(k0);
    const cSep = await stat(api, 'categories?from=2026-09&to=2026-09&type=expense');
    expect((await tableRows(page.locator('#chart-donut'))).map((r) => r[0])).toEqual(cSep.items.map((i) => i.category));
    await expect(page.locator('#chart-donut svg[role="img"] desc')).toContainText('2026년 9월');
    // 다음 달 -> 원래대로
    await page.locator('#dash-next').click();
    await expect(page.locator('#dash-month')).toHaveText('2026년 10월');
    await expect.poll(kpiText).toBe(k0); // 재조회 완료까지 대기

    // 6 -> 12개월
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(6);
    await page.locator('#range-12').click();
    await expect(page.locator('#range-12')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#range-6')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
    await expect(page.locator('#chart-cat-trend table tbody tr')).toHaveCount(12);
    const m12 = await stat(api, 'monthly?from=2025-11&to=2026-10');
    expect(await tableRows(page.locator('#chart-monthly'))).toEqual(
      m12.months.map((x) => [monthTitleOf(x.month), fmtWon(x.incomeTotal), fmtWon(x.expenseTotal), fmtWon(x.balance)]));
    await expectNoBadNumbers(page);
    await page.locator('#range-6').click();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(6);

    // 카테고리 칩 선택
    const chips = page.locator('#cat-trend-chips button');
    expect(await chips.count()).toBeGreaterThan(1);
    const first = (await chips.first().textContent()).replace(/^\s*✓?\s*/, '').trim();
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#chart-cat-trend figcaption')).toHaveText(`${first} 월별 지출 추이`);
    const second = chips.nth(1);
    const secondName = (await second.textContent()).replace(/^\s*✓?\s*/, '').trim();
    await second.click();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#chart-cat-trend figcaption')).toHaveText(`${secondName} 월별 지출 추이`);
    const cm = await stat(api, 'category-monthly?from=2026-05&to=2026-10&type=expense');
    const s = cm.series.find((x) => x.category === secondName);
    expect(await tableRows(page.locator('#chart-cat-trend'))).toEqual(cm.months.map((mm, i) => [monthTitleOf(mm), fmtWon(s.totals[i])]));

    expect(await page.evaluate(() => window.__qaMarker)).toBe(42); // 새로고침(페이지 재로드) 없음
    await expect(page.locator('#dash-error')).toHaveText('');
    await ctx.close();
  });
});

test.describe('C67 탭 전환 재조회', () => {
  test('C67 기록 탭에서 거래 추가 후 대시보드 탭으로 전환하면 KPI 지출이 그만큼 늘어 있다 (UI 입력)', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('c67');
    await addTx(api, { memo: '기존', amount: 5000, category: '식비', date: FIXED_TODAY });
    const { ctx, page } = await newUiPage(browser, testInfo, { api });
    await page.goto('/#dashboard');
    await expect(page.locator('#kpi .kpi-value').nth(1)).toHaveText('5,000원');
    await page.locator('#tab-record').click();
    await expect(page.locator('#panel-record')).toBeVisible();
    await page.locator('#amount').fill('12500');
    await page.locator('#category-chips button', { hasText: '교통' }).click();
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await page.locator('#tab-dashboard').click();
    await expect(page.locator('#kpi .kpi-value').nth(1)).toHaveText('17,500원');
    await expect(page.locator('#chart-donut .legend li')).toHaveCount(2);
    // 삭제 후에도 다시 반영
    await page.locator('#tab-record').click();
    page.removeAllListeners('dialog');
    page.once('dialog', (d) => d.accept());
    await page.locator('.tx-row', { hasText: '12,500원' }).locator('.tx-del').click();
    await expect(page.locator('#flash')).toHaveText('삭제했어요');
    await page.locator('#tab-dashboard').click();
    await expect(page.locator('#kpi .kpi-value').nth(1)).toHaveText('5,000원');
    await ctx.close();
  });
});
