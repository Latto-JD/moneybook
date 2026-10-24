// 대시보드 탭 (F10): 기준 월 이동, 6/12개월 전환, KPI, 도넛, 월별 수입/지출, 카테고리별 월 추이
import { api } from './api.js';
import { el, $, chipItem, keepFocus } from './dom.js';
import { renderSummaryCard } from './summary-card.js';
import { loadInsights } from './insights.js';
import { motionFor, applyMotion } from './lib/motion.js';
import { categoryResponse } from './categories.js';
import { stableVizMap } from './lib/viz.js';
import { todayLocal, monthOf, shiftMonth, monthTitle, trailingRange } from './lib/date.js';
import { renderDonut, renderGroupedBars, renderBars } from './charts.js';
import {
  buildKpi, balanceRate, balanceLabel, summaryLabel, NO_PREV_TEXT, NO_PREV_ALL_TEXT, donutItemsFrom, groupDonutItems, trendCategories, defaultTrendCategory, seriesFor,
} from './lib/dashboard-data.js';

// 카테고리 보기(도넛·추이) 유형별 문구. 지출과 수입은 같은 구조의 문장을 쓴다.
const VIEW = {
  expense: { noun: '지출', donutTitle: '카테고리 지출 비중', centerLabel: '총 지출', heading: '카테고리별 지출' },
  income: { noun: '수입', donutTitle: '카테고리 수입 비중', centerLabel: '총 수입', heading: '카테고리별 수입' },
};

const state = {
  base: null, // initDashboard 시점의 오늘 기준으로 채운다
  range: 6,
  catType: 'expense', // 카테고리 보기. 탭을 오가도 유지되고, 새로고침하면 지출로 돌아간다
  trend: null, // category-monthly 응답 캐시
  catResp: null, // stats/categories 응답 캐시 (추이 기본 선택용)
  selected: null,
};

const catVizMap = () => stableVizMap(categoryResponse() && categoryResponse().items, state.catType);

/** 요약 카드(기록 화면과 같은 그리기): 남은 돈 + 비율 + 수입 | 지출, 전월 대비 문구는 각 열 아래 */
function renderKpi(kpi, base, motion) {
  const thisMonth = monthOf(todayLocal());
  $('kpi').setAttribute('aria-label', summaryLabel(base, thisMonth));
  // ▲/▼ 는 방향만 알려 준다. 색은 보조 글자색 (늘고 줄어드는 것에 좋고 나쁨을 매기지 않는다)
  const note = (change) => (change
    ? { cls: change.direction, text: { up: '▲ ', down: '▼ ', same: '= ' }[change.direction] + change.text }
    : { cls: 'muted', text: '—', srText: NO_PREV_TEXT }); // 한쪽만 없으면 짧게
  const noneAtAll = !kpi.incomeChange && !kpi.expenseChange;
  applyMotion($('kpi'), motion);
  renderSummaryCard($('kpi'), {
    balanceLabel: balanceLabel(base, thisMonth),
    income: kpi.income, expense: kpi.expense, balance: kpi.balance,
    rate: balanceRate(kpi.income, kpi.balance),
    // 둘 다 비교값이 없으면 칸마다 반복하지 않고 카드 아래 한 줄만
    notes: noneAtAll ? null : { income: note(kpi.incomeChange), expense: note(kpi.expenseChange) },
    footnote: noneAtAll ? NO_PREV_ALL_TEXT : '',
  });
}

function renderTrend(motion = motionFor('chip', 'trend')) {
  const chips = $('cat-trend-chips');
  const cats = trendCategories(state.trend);
  const box = $('chart-cat-trend');
  applyMotion(box, motion);
  if (!cats.length) {
    chips.replaceChildren();
    renderBars(box, { title: '카테고리별 월 추이', seriesName: VIEW[state.catType].noun, months: [], totals: [] }); // 빈 상태 문구
    return;
  }
  chips.replaceChildren(...cats.map((c) => chipItem(c.category, {
    pressed: c.category === state.selected,
    onClick: () => { state.selected = c.category; keepFocus(chips, () => renderTrend()); },
  })));
  const s = seriesFor(state.trend, state.selected);
  renderBars(box, { title: `${state.selected} 월별 ${VIEW[state.catType].noun} 추이`, ...s, viz: catVizMap().get(state.selected) });
}

// 요청 종류별 순서 번호: 더 최근 요청이 있으면 오래된 응답을 버린다.
// 달 변경·탭 진입은 전부(loadAll), 기간(6/12개월) 변경은 월별·추이만, 보기(지출/수입) 변경은 카테고리·추이만 다시 받는다.
const seqs = { monthly: 0, cat: 0, trend: 0 };
const showError = (e) => { $('dash-error').textContent = (e && e.message) || '데이터를 불러오지 못했어요.'; };

async function loadMonthly(reason) {
  const my = ++seqs.monthly;
  const r = trailingRange(state.base, state.range);
  const base = state.base;
  try {
    const monthly = await api.statsMonthly(r.from, r.to);
    if (my !== seqs.monthly) return;
    renderKpi(buildKpi(monthly.months, base), base, motionFor(reason, 'kpi'));
    applyMotion($('chart-monthly'), motionFor(reason, 'monthly'));
    renderGroupedBars($('chart-monthly'), { title: '월별 수입 대 지출', months: monthly.months });
  } catch (e) {
    if (my === seqs.monthly) showError(e);
  }
}

/** 카테고리 응답을 돌려준다(추이의 기본 선택에 쓴다). 실패하면 null */
async function loadCat(reason) {
  const my = ++seqs.cat;
  const base = state.base;
  try {
    const cat = await api.statsCategories(base, base, state.catType);
    if (my !== seqs.cat) return null;
    const v = VIEW[state.catType];
    state.catResp = cat;
    applyMotion($('chart-donut'), motionFor(reason, 'donut'));
    renderDonut($('chart-donut'), {
      title: v.donutTitle, periodLabel: monthTitle(base), items: groupDonutItems(donutItemsFrom(cat)),
      centerLabel: v.centerLabel, noun: v.noun, vizMap: catVizMap(),
    });
    return cat;
  } catch (e) {
    if (my === seqs.cat) showError(e);
    return null;
  }
}

async function loadTrend(reason, catPromise = Promise.resolve(state.catResp)) {
  const my = ++seqs.trend;
  const r = trailingRange(state.base, state.range);
  try {
    const [trend, cat] = await Promise.all([api.statsCategoryMonthly(r.from, r.to, state.catType), catPromise]);
    if (my !== seqs.trend) return;
    state.trend = trend;
    const keep = trendCategories(trend).some((c) => c.category === state.selected);
    if (!keep) state.selected = defaultTrendCategory(cat, trend);
    renderTrend(motionFor(reason, 'trend'));
  } catch (e) {
    if (my === seqs.trend) showError(e);
  }
}

/** reason: 'month' | 'tab' | 'catchange' (lib/motion.js) */
function loadAll(reason) {
  $('dash-month').textContent = monthTitle(state.base);
  $('dash-error').textContent = '';
  loadInsights(state.base, { fade: motionFor(reason, 'insights').fade }); // 인사이트는 달이 바뀔 때와 탭에 들어올 때만
  loadMonthly(reason);
  loadTrend(reason, loadCat(reason));
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
  state.catResp = null;
  renderCatView();
  loadTrend('catview', loadCat('catview'));
}

function setRange(n) {
  state.range = n;
  $('range-6').setAttribute('aria-pressed', String(n === 6));
  $('range-12').setAttribute('aria-pressed', String(n === 12));
  loadMonthly('range');
  loadTrend('range');
}

export function initDashboard() {
  state.base = monthOf(todayLocal());
  $('dash-prev').addEventListener('click', () => { state.base = shiftMonth(state.base, -1) || state.base; loadAll('month'); });
  $('dash-next').addEventListener('click', () => { state.base = shiftMonth(state.base, 1) || state.base; loadAll('month'); });
  $('catview-expense').addEventListener('click', () => setCatType('expense'));
  $('catview-income').addEventListener('click', () => setCatType('income'));
  renderCatView();
  $('range-6').addEventListener('click', () => setRange(6));
  $('range-12').addEventListener('click', () => setRange(12));
  // 탭 전환 시 재조회 (저장/수정/삭제 후에도 최신)
  document.addEventListener('tabchange', (ev) => { if (ev.detail.tab === 'dashboard') loadAll('tab'); });
  // 카테고리 목록이 늦게 도착하거나 바뀌면 색·무늬 번호가 달라질 수 있으니 열려 있을 때 다시 그린다
  document.addEventListener('categorieschanged', () => { if (!$('panel-dashboard').hidden) loadAll('catchange'); });
  if (!$('panel-dashboard').hidden) loadAll('tab');
}
