// 대시보드 탭 (F10): 기준 월 이동, 6/12개월 전환, KPI, 도넛, 월별 수입/지출, 카테고리별 월 추이
import { api } from './api.js';
import { el, $, chipItem, keepFocus } from './dom.js';
import { formatWon } from './lib/money.js';
import { todayLocal, monthOf, shiftMonth, monthTitle, trailingRange } from './lib/date.js';
import { renderDonut, renderGroupedBars, renderBars } from './charts.js';
import {
  buildKpi, NO_PREV_TEXT, donutItemsFrom, groupDonutItems, trendCategories, defaultTrendCategory, seriesFor,
} from './lib/dashboard-data.js';

// 카테고리 보기(도넛·추이) 유형별 문구. 지출과 수입은 같은 구조의 문장을 쓴다.
const VIEW = {
  expense: { noun: '지출', donutTitle: '카테고리 지출 비중', centerLabel: '총 지출' },
  income: { noun: '수입', donutTitle: '카테고리 수입 비중', centerLabel: '총 수입' },
};

const state = {
  base: null, // initDashboard 시점의 오늘 기준으로 채운다
  range: 6,
  catType: 'expense', // 카테고리 보기. 탭을 오가도 유지되고, 새로고침하면 지출로 돌아간다
  trend: null, // category-monthly 응답 캐시
  selected: null,
};
let seq = 0;

function renderKpi(kpi) {
  const card = (label, value, change) => {
    const d = el('div', { class: 'kpi' });
    d.appendChild(el('div', { class: 'kpi-label' }, label));
    d.appendChild(el('div', { class: 'kpi-value' }, value));
    if (change !== undefined) {
      // ▲/▼ 는 방향만 알려 준다. 색은 본문색 (늘고 줄어드는 것에 좋고 나쁨을 매기지 않는다)
      const text = change ? { up: '▲ ', down: '▼ ', same: '= ' }[change.direction] + change.text : NO_PREV_TEXT;
      d.appendChild(el('div', { class: `kpi-extra ${change ? change.direction : 'muted'}` }, text));
    }
    return d;
  };
  $('kpi').replaceChildren(
    card('수입', formatWon(kpi.income), kpi.incomeChange),
    card('지출', formatWon(kpi.expense), kpi.expenseChange),
    card('잔액', formatWon(kpi.balance)),
  );
}

function renderTrend() {
  const chips = $('cat-trend-chips');
  const cats = trendCategories(state.trend);
  const box = $('chart-cat-trend');
  if (!cats.length) {
    chips.replaceChildren();
    renderBars(box, { title: '카테고리별 월 추이', seriesName: VIEW[state.catType].noun, months: [], totals: [] }); // 빈 상태 문구
    return;
  }
  chips.replaceChildren(...cats.map((c) => chipItem(c.category, {
    pressed: c.category === state.selected,
    onClick: () => { state.selected = c.category; keepFocus(chips, renderTrend); },
  })));
  const s = seriesFor(state.trend, state.selected);
  renderBars(box, { title: `${state.selected} 월별 ${VIEW[state.catType].noun} 추이`, ...s });
}

async function load() {
  const my = ++seq;
  const base = state.base;
  const r = trailingRange(base, state.range);
  $('dash-month').textContent = monthTitle(base);
  $('dash-error').textContent = '';
  const [monthly, cat, trend] = await Promise.allSettled([
    api.statsMonthly(r.from, r.to),
    api.statsCategories(base, base, state.catType),
    api.statsCategoryMonthly(r.from, r.to, state.catType),
  ]);
  if (my !== seq) return; // 더 최근 요청이 있으면 버림
  const failed = [monthly, cat, trend].find((x) => x.status === 'rejected');
  if (failed) $('dash-error').textContent = failed.reason?.message || '데이터를 불러오지 못했어요.';

  if (monthly.status === 'fulfilled') {
    renderKpi(buildKpi(monthly.value.months, base));
    renderGroupedBars($('chart-monthly'), { title: '월별 수입 대 지출', months: monthly.value.months });
  }
  if (cat.status === 'fulfilled') {
    const v = VIEW[state.catType];
    renderDonut($('chart-donut'), {
      title: v.donutTitle, periodLabel: monthTitle(base), items: groupDonutItems(donutItemsFrom(cat.value)),
      centerLabel: v.centerLabel, noun: v.noun,
    });
  }
  if (trend.status === 'fulfilled') {
    state.trend = trend.value;
    const keep = trendCategories(trend.value).some((c) => c.category === state.selected);
    if (!keep) state.selected = defaultTrendCategory(cat.status === 'fulfilled' ? cat.value : null, trend.value);
    renderTrend();
  }
}

function renderCatView() {
  $('catview-expense').setAttribute('aria-pressed', String(state.catType === 'expense'));
  $('catview-income').setAttribute('aria-pressed', String(state.catType === 'income'));
  $('chart-donut').setAttribute('aria-label', VIEW[state.catType].donutTitle);
}

function setCatType(type) {
  if (state.catType === type) return;
  state.catType = type;
  state.selected = null; // 다른 유형의 카테고리 이름이 남지 않게
  state.trend = null;
  renderCatView();
  load();
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
  $('catview-expense').addEventListener('click', () => setCatType('expense'));
  $('catview-income').addEventListener('click', () => setCatType('income'));
  renderCatView();
  $('range-6').addEventListener('click', () => setRange(6));
  $('range-12').addEventListener('click', () => setRange(12));
  // 탭 전환 시 재조회 (저장/수정/삭제 후에도 최신)
  document.addEventListener('tabchange', (ev) => { if (ev.detail.tab === 'dashboard') load(); });
  if (!$('panel-dashboard').hidden) load();
}
