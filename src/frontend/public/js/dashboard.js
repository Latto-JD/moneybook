// 대시보드 탭 (F10): 기준 월 이동, 6/12개월 전환, KPI, 도넛, 월별 수입/지출, 카테고리별 월 추이
import { api } from './api.js';
import { el, $, chipItem, keepFocus } from './dom.js';
import { formatWon, formatBalanceWon } from './lib/money.js';
import { categoryResponse } from './categories.js';
import { stableVizMap } from './lib/viz.js';
import { todayLocal, monthOf, shiftMonth, monthTitle, trailingRange } from './lib/date.js';
import { renderDonut, renderGroupedBars, renderBars } from './charts.js';
import {
  buildKpi, balanceBars, NO_PREV_TEXT, donutItemsFrom, groupDonutItems, trendCategories, defaultTrendCategory, seriesFor,
} from './lib/dashboard-data.js';

// 카테고리 보기(도넛·추이) 유형별 문구. 지출과 수입은 같은 구조의 문장을 쓴다.
const VIEW = {
  expense: { noun: '지출', donutTitle: '카테고리 지출 비중', centerLabel: '총 지출', heading: '어디에 썼나' },
  income: { noun: '수입', donutTitle: '카테고리 수입 비중', centerLabel: '총 수입', heading: '어디서 들어왔나' },
};

const state = {
  base: null, // initDashboard 시점의 오늘 기준으로 채운다
  range: 6,
  catType: 'expense', // 카테고리 보기. 탭을 오가도 유지되고, 새로고침하면 지출로 돌아간다
  trend: null, // category-monthly 응답 캐시
  selected: null,
};
let seq = 0;

const catVizMap = () => stableVizMap(categoryResponse() && categoryResponse().items, state.catType);

/** 균형 카드: 남은 돈(크게) + 수입·지출 같은 크기 두 칸. 두 막대는 둘 중 큰 값을 100%로 하는 같은 기준 */
function renderKpi(kpi) {
  const bars = balanceBars(kpi.income, kpi.expense);
  const pair = (kind, label, value, ratio, change) => {
    const d = el('div', { class: `kpi kpi--${kind}` });
    const head = el('div', { class: 'kpi-label' });
    head.appendChild(el('span', { class: `icon icon--${kind}`, 'aria-hidden': 'true' }));
    head.appendChild(document.createTextNode(label));
    d.appendChild(head);
    d.appendChild(el('div', { class: `kpi-value figure amt-${kind}`, 'aria-label': `${label} ${formatWon(value)}` }, formatWon(value)));
    const track = el('div', { class: 'bar-track', 'aria-hidden': 'true' });
    const fill = el('div', { class: `bar-fill ${kind}` });
    fill.style.width = `${ratio}%`;
    track.appendChild(fill);
    d.appendChild(track);
    // ▲/▼ 는 방향만 알려 준다. 색은 보조 글자색 (늘고 줄어드는 것에 좋고 나쁨을 매기지 않는다)
    const text = change ? { up: '▲ ', down: '▼ ', same: '= ' }[change.direction] + change.text : NO_PREV_TEXT;
    d.appendChild(el('div', { class: `kpi-extra ${change ? change.direction : 'muted'}` }, text));
    return d;
  };
  const balance = el('div', { class: 'kpi kpi--balance' });
  balance.appendChild(el('div', { class: 'kpi-label' }, '이번 달 남은 돈'));
  balance.appendChild(el('div', { class: 'kpi-value figure' }, formatBalanceWon(kpi.balance)));
  const row = el('div', { class: 'balance-pair' });
  row.appendChild(pair('income', '수입', kpi.income, bars.income, kpi.incomeChange));
  row.appendChild(pair('expense', '지출', kpi.expense, bars.expense, kpi.expenseChange));
  // 읽는 순서 = 화면 순서: 남은 돈 -> 수입 -> 지출
  $('kpi').replaceChildren(balance, row);
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
  renderBars(box, { title: `${state.selected} 월별 ${VIEW[state.catType].noun} 추이`, ...s, viz: catVizMap().get(state.selected) });
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
      centerLabel: v.centerLabel, noun: v.noun, vizMap: catVizMap(),
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
  $('donut-title').textContent = VIEW[state.catType].heading;
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
  // 카테고리 목록이 늦게 도착하거나 바뀌면 색·무늬 번호가 달라질 수 있으니 열려 있을 때 다시 그린다
  document.addEventListener('categorieschanged', () => { if (!$('panel-dashboard').hidden) load(); });
  if (!$('panel-dashboard').hidden) load();
}
