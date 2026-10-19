// 대시보드 탭 (F10): 기준 월 이동, 6/12개월 전환, KPI, 도넛, 월별 수입/지출, 카테고리별 월 추이
import { api } from './api.js';
import { el, $, chipItem, keepFocus } from './dom.js';
import { formatWon } from './lib/money.js';
import { todayLocal, monthOf, shiftMonth, monthTitle, trailingRange } from './lib/date.js';
import { renderDonut, renderGroupedBars, renderBars } from './charts.js';
import {
  buildKpi, NO_PREV_TEXT, donutItemsFrom, trendCategories, defaultTrendCategory, seriesFor,
} from './lib/dashboard-data.js';

const state = {
  base: null, // initDashboard 시점의 오늘 기준으로 채운다
  range: 6,
  trend: null, // category-monthly 응답 캐시
  selected: null,
};
let seq = 0;

function renderKpi(kpi) {
  const card = (label, value, extra, extraClass) => {
    const d = el('div', { class: 'kpi' });
    d.appendChild(el('div', { class: 'kpi-label' }, label));
    d.appendChild(el('div', { class: 'kpi-value' }, value));
    if (extra) d.appendChild(el('div', { class: `kpi-extra ${extraClass || ''}` }, extra));
    return d;
  };
  let changeText = NO_PREV_TEXT;
  let changeClass = 'muted';
  if (kpi.change) {
    const mark = { up: '▲ ', down: '▼ ', same: '= ' }[kpi.change.direction];
    changeText = mark + kpi.change.text;
    changeClass = kpi.change.direction;
  }
  $('kpi').replaceChildren(
    card('수입', formatWon(kpi.income)),
    card('지출', formatWon(kpi.expense), changeText, changeClass),
    card('잔액', formatWon(kpi.balance)),
  );
}

function renderTrend() {
  const chips = $('cat-trend-chips');
  const cats = trendCategories(state.trend);
  const box = $('chart-cat-trend');
  if (!cats.length) {
    chips.replaceChildren();
    renderBars(box, { title: '카테고리별 월 추이', seriesName: '지출', months: [], totals: [] }); // 빈 상태 문구
    return;
  }
  chips.replaceChildren(...cats.map((c) => chipItem(c.category, {
    pressed: c.category === state.selected,
    onClick: () => { state.selected = c.category; keepFocus(chips, renderTrend); },
  })));
  const s = seriesFor(state.trend, state.selected);
  renderBars(box, { title: `${state.selected} 월별 지출 추이`, ...s });
}

async function load() {
  const my = ++seq;
  const base = state.base;
  const r = trailingRange(base, state.range);
  $('dash-month').textContent = monthTitle(base);
  $('dash-error').textContent = '';
  const [monthly, cat, trend] = await Promise.allSettled([
    api.statsMonthly(r.from, r.to),
    api.statsCategories(base, base, 'expense'),
    api.statsCategoryMonthly(r.from, r.to, 'expense'),
  ]);
  if (my !== seq) return; // 더 최근 요청이 있으면 버림
  const failed = [monthly, cat, trend].find((x) => x.status === 'rejected');
  if (failed) $('dash-error').textContent = failed.reason?.message || '데이터를 불러오지 못했어요.';

  if (monthly.status === 'fulfilled') {
    renderKpi(buildKpi(monthly.value.months, base));
    renderGroupedBars($('chart-monthly'), { title: '월별 수입 대 지출', months: monthly.value.months });
  }
  if (cat.status === 'fulfilled') {
    renderDonut($('chart-donut'), {
      title: '카테고리 지출 비중', periodLabel: monthTitle(base), items: donutItemsFrom(cat.value),
    });
  }
  if (trend.status === 'fulfilled') {
    state.trend = trend.value;
    const keep = trendCategories(trend.value).some((c) => c.category === state.selected);
    if (!keep) state.selected = defaultTrendCategory(cat.status === 'fulfilled' ? cat.value : null, trend.value);
    renderTrend();
  }
}

function setRange(n) {
  state.range = n;
  $('range-6').setAttribute('aria-pressed', String(n === 6));
  $('range-12').setAttribute('aria-pressed', String(n === 12));
  load();
}

export function initDashboard() {
  state.base = monthOf(todayLocal());
  $('dash-prev').addEventListener('click', () => { state.base = shiftMonth(state.base, -1) || state.base; load(); });
  $('dash-next').addEventListener('click', () => { state.base = shiftMonth(state.base, 1) || state.base; load(); });
  $('range-6').addEventListener('click', () => setRange(6));
  $('range-12').addEventListener('click', () => setRange(12));
  // 탭 전환 시 재조회 (저장/수정/삭제 후에도 최신)
  document.addEventListener('tabchange', (ev) => { if (ev.detail.tab === 'dashboard') load(); });
  if (!$('panel-dashboard').hidden) load();
}
