// SVG 차트 컴포넌트 3종 (도넛, 묶은 막대, 막대). 외부 라이브러리 없음.
// 모든 문자열은 textContent / setAttribute 로만 넣는다 (innerHTML 미사용, 인라인 style 미사용: CSP).
// 색은 전부 CSS 클래스(tokens.css 의 --viz-N, --color-income 등)로 입힌다: 다크 모드에서 같이 바뀐다.
import { formatWon } from './lib/money.js';
import { monthShort, monthTitle } from './lib/date.js';
import {
  donutSegments, formatPercent, niceScale, barHeight, formatTick, labelStep, barLayout, ratioOf,
} from './lib/chart-geometry.js';
import { assignDonutViz, VIZ_COUNT } from './lib/viz.js';
import { swatch } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const EMPTY_TEXT = '아직 이 기간에 기록이 없어요';

// 도넛 규격 (핸드오프): 바깥 92, 안쪽 60, 조각 사이 2px 는 CSS(.donut__slice 의 stroke = --viz-gap)
const DONUT_OUTER = 92;
const DONUT_INNER = 60;

// 번호 2..8 의 무늬 (patterns/viz-N.svg 와 같은 모양). 1번은 단색. 선 색은 --viz-pattern-ink.
const VIZ_MARKS = {
  2: [['path', { d: 'M-2 2l4-4M0 8l8-8M6 10l4-4', 'stroke-width': 1.6, class: 'viz-ink-stroke' }]],
  3: [['circle', { cx: 2, cy: 2, r: 1.3, class: 'viz-ink' }], ['circle', { cx: 6, cy: 6, r: 1.3, class: 'viz-ink' }]],
  4: [['path', { d: 'M0 2h8M0 6h8', 'stroke-width': 1.4, class: 'viz-ink-stroke' }]],
  5: [['path', { d: 'M0 4h8M4 0v8', 'stroke-width': 1.3, class: 'viz-ink-stroke' }]],
  6: [['path', { d: 'M2 0v8M6 0v8', 'stroke-width': 1.4, class: 'viz-ink-stroke' }]],
  7: [['rect', { x: 0, y: 0, width: 4, height: 4, class: 'viz-ink' }], ['rect', { x: 4, y: 4, width: 4, height: 4, class: 'viz-ink' }]],
  8: [['path', { d: 'M-2 6l4 4M0 0l8 8M6 -2l4 4', 'stroke-width': 1.6, class: 'viz-ink-stroke' }]],
};
// 월별 막대: 수입 = / 사선, 지출 = \ 사선. 선 개수(밀도)를 같게 한다.
const BAR_MARKS = {
  income: { base: 'chart-fill-income', d: 'M-2 2L2 -2M0 8L8 0M6 10L10 6' },
  expense: { base: 'chart-fill-expense', d: 'M-2 6L2 10M0 0L8 8M6 -2L10 2' },
};

let uid = 0;
const nextId = (p) => `${p}${++uid}`;

function h(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
function s(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** <defs> 에 번호 n(2..8) 의 색 + 무늬 패턴을 넣고 fill 값(url)을 반환 */
function addVizPattern(defs, id, n) {
  const p = s('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
  p.appendChild(s('rect', { width: 8, height: 8, class: `viz-fill-${n}` }));
  for (const [tag, attrs] of VIZ_MARKS[n] || []) p.appendChild(s(tag, attrs));
  defs.appendChild(p);
  return `url(#${id})`;
}

/** 수입/지출 막대 무늬 패턴 */
function addBarPattern(defs, id, kind) {
  const m = BAR_MARKS[kind];
  const p = s('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
  p.appendChild(s('rect', { width: 8, height: 8, class: m.base }));
  p.appendChild(s('path', { d: m.d, 'stroke-width': 1.6, class: 'viz-ink-stroke' }));
  defs.appendChild(p);
  return `url(#${id})`;
}

/** 막대 범례 견본: 같은 문서의 패턴 id 를 참조한다 */
function patternSwatch(fill) {
  const svg = s('svg', { class: 'swatch-svg', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(s('rect', { x: 0.5, y: 0.5, width: 15, height: 15, rx: 2, fill, class: 'chart-stroke' }));
  return svg;
}

function emptyState(container) {
  container.replaceChildren(h('p', { class: 'chart-empty', role: 'status' }, EMPTY_TEXT));
}

/** 표 대체. columns: 열 이름 배열, rows: [{head, cells:[string]}], foot: {head, cells}|null */
function buildTable(caption, headLabel, columns, rows, foot) {
  const details = h('details', { class: 'chart-table' });
  const summary = h('summary', { class: 'btn btn--ghost btn--sm' });
  summary.appendChild(h('span', { class: 'icon icon--table', 'aria-hidden': 'true' }));
  summary.appendChild(h('span', {}, '표로 보기'));
  details.appendChild(summary);
  const wrap = h('div', { class: 'table-wrap' });
  const table = h('table');
  table.appendChild(h('caption', {}, caption));
  const thead = h('thead');
  const tr = h('tr');
  tr.appendChild(h('th', { scope: 'col' }, headLabel));
  for (const c of columns) tr.appendChild(h('th', { scope: 'col', class: 'num' }, c));
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = h('tbody');
  const addRow = (parent, r) => {
    const row = h('tr');
    row.appendChild(h('th', { scope: 'row' }, r.head));
    for (const c of r.cells) row.appendChild(h('td', { class: 'num' }, c));
    parent.appendChild(row);
  };
  rows.forEach((r) => addRow(tbody, r));
  table.appendChild(tbody);
  if (foot) {
    const tfoot = h('tfoot');
    addRow(tfoot, foot);
    table.appendChild(tfoot);
  }
  wrap.appendChild(table);
  details.appendChild(wrap);
  return details;
}

function figureShell(title) {
  const figure = h('figure', { class: 'chart' });
  figure.appendChild(h('figcaption', {}, title));
  return figure;
}

function svgShell(vbW, vbH, title, summary) {
  const titleId = nextId('ct');
  const descId = nextId('cd');
  const svg = s('svg', {
    class: 'chart-svg', viewBox: `0 0 ${vbW} ${vbH}`, role: 'img',
    'aria-labelledby': `${titleId} ${descId}`, focusable: 'false',
  });
  svg.appendChild(s('title', { id: titleId }, title));
  svg.appendChild(s('desc', { id: descId }, summary));
  const defs = s('defs');
  svg.appendChild(defs);
  return { svg, defs };
}

function legendItem(marker, label, extra) {
  const li = h('li');
  li.appendChild(marker);
  li.appendChild(h('span', { class: 'legend-label' }, label));
  if (extra) for (const [cls, text] of extra) li.appendChild(h('span', { class: cls }, text));
  return li;
}

/**
 * 도넛. opts: { title, periodLabel, items:[{label,value}], centerLabel='총 지출', noun='지출', vizMap }
 * 조각 순서 = 범례 순서 = 금액 내림차순 (12시 방향 시계방향).
 * 색·무늬 번호는 vizMap(이름 -> 1..8, lib/viz.js)의 고정 번호를 우선 쓰고, 없거나 겹치면 남은 가장 작은 번호.
 * items 에 { members:[{label,value}], pinLast:true } 인 "그 외 N개" 묶음이 있으면 마지막 조각(중립 단색)으로 그리고,
 * 범례에 묶인 이름을 나열하며, 표 대체에는 묶지 않은 전체 행을 싣는다.
 */
export function renderDonut(container, opts) {
  const { title, periodLabel = '', items, centerLabel = '총 지출', noun = '지출', vizMap = null } = opts;
  const segs = donutSegments(items, { cx: 100, cy: 100, outerR: DONUT_OUTER, innerR: DONUT_INNER });
  if (segs.length === 0) return emptyState(container);
  const total = segs.reduce((a, x) => a + x.value, 0);
  const top = segs[0];
  const summary = `${periodLabel ? periodLabel + ' ' : ''}${noun} ${formatWon(total)} 중 ${top.label} ${formatPercent(top.ratio)}로 가장 큼`;

  const figure = figureShell(title);
  const { svg, defs } = svgShell(200, 200, title, summary);
  const vizs = assignDonutViz(segs, vizMap);
  segs.forEach((seg, i) => {
    const v = vizs[i];
    const attrs = { d: seg.path, 'fill-rule': 'evenodd', 'data-viz': String(v) };
    if (v === 'other') attrs.class = 'donut__slice viz-other';
    else if (v === 1) attrs.class = 'donut__slice viz-fill-1';
    else { attrs.class = 'donut__slice'; attrs.fill = addVizPattern(defs, nextId('pt'), v); }
    svg.appendChild(s('path', attrs));
  });
  svg.appendChild(s('text', { x: 100, y: 92, 'text-anchor': 'middle', class: 'chart-text chart-text-sub' }, centerLabel));
  svg.appendChild(s('text', { x: 100, y: 114, 'text-anchor': 'middle', class: 'chart-text donut__value' }, formatWon(total)));

  const body = h('div', { class: 'chart-body donut-body' });
  body.appendChild(svg);
  const legend = h('ol', { class: 'legend legend-list' });
  const maxValue = segs.reduce((m, x) => Math.max(m, x.value), 0);
  segs.forEach((seg, i) => {
    const li = legendItem(swatch(vizs[i]), seg.label, [['legend-amount', formatWon(seg.value)], ['legend-ratio', formatPercent(seg.ratio)]]);
    // 막대(장식): 가장 큰 항목 = 100%. 색은 견본과 같은 번호(data-viz)가 정한다
    const bar = h('span', { class: 'legend-bar', 'aria-hidden': 'true' });
    const fill = h('span', { class: 'legend-bar__fill', 'data-viz': Array.isArray(seg.members) ? 'other' : String(vizs[i]) });
    if (fill.style) {
      fill.style.width = `${maxValue > 0 ? Math.round((seg.value / maxValue) * 1000) / 10 : 0}%`;
      fill.style.setProperty('--motion-i', String(i)); // 스태거 순번(CSSOM). 지연 상한은 CSS 가 둔다
    }
    bar.appendChild(fill);
    li.appendChild(bar);
    if (Array.isArray(seg.members)) {
      // 묶음 행: 같은 이름의 실제 카테고리와 글자만으로 구분되지 않으므로 보이지 않는 설명을 붙인다
      const descId = nextId('lg');
      li.setAttribute('aria-describedby', descId);
      li.setAttribute('data-viz', 'other');
      li.appendChild(h('span', { class: 'visually-hidden', id: descId }, '여러 카테고리를 합친 항목'));
      li.appendChild(h('span', { class: 'legend-members' }, seg.members.map((m) => m.label).join(', ')));
    }
    legend.appendChild(li);
  });
  // 표는 묶지 않은 전체 카테고리 행 + 합계
  const tableRows = segs.flatMap((x) => (Array.isArray(x.members) ? x.members : [x]));
  body.appendChild(legend);
  figure.appendChild(body);
  figure.appendChild(h('p', { class: 'chart-summary' }, summary));
  figure.appendChild(buildTable(`${title} 표`, '카테고리', ['금액', '비율'],
    tableRows.map((x) => ({ head: x.label, cells: [formatWon(x.value), formatPercent(ratioOf(x.value, total))] })),
    { head: '합계', cells: [formatWon(total), formatPercent(1)] }));
  container.replaceChildren(figure);
}

// ---- 막대 공통 ----
const VB_W = 320;
const VB_H = 220;
const M = { left: 44, right: 8, top: 12, bottom: 28 };
const PLOT_W = VB_W - M.left - M.right;
const PLOT_H = VB_H - M.top - M.bottom;

function drawAxes(svg, labels, maxValue) {
  const sc = niceScale(maxValue, 4);
  const yOf = (v) => M.top + PLOT_H - (sc.max > 0 ? (v / sc.max) * PLOT_H : 0);
  for (const t of sc.ticks) {
    const y = yOf(t);
    svg.appendChild(s('line', { x1: M.left, x2: VB_W - M.right, y1: y, y2: y, class: t === 0 ? 'chart-axis' : 'chart-grid' }));
    svg.appendChild(s('text', { x: M.left - 4, y: y + 4, 'text-anchor': 'end', class: 'chart-text' }, formatTick(t)));
  }
  // 월 레이블은 겹치면 격월 (표에는 전체)
  const step = labelStep(labels.length, PLOT_W, 28);
  const slot = PLOT_W / labels.length;
  labels.forEach((ym, i) => {
    if (i % step !== 0) return;
    svg.appendChild(s('text', {
      x: M.left + slot * i + slot / 2, y: VB_H - 8, 'text-anchor': 'middle', class: 'chart-text',
    }, monthShort(ym)));
  });
  return sc;
}

/**
 * 묶은 막대: 월별 수입(/ 무늬) vs 지출(\ 무늬).
 * opts: { title, months:[{month, incomeTotal, expenseTotal, balance}] }  (api stats/monthly 의 months 그대로)
 */
export function renderGroupedBars(container, opts) {
  const { title, months } = opts;
  const rows = Array.isArray(months) ? months : [];
  const max = rows.reduce((m, r) => Math.max(m, r.incomeTotal || 0, r.expenseTotal || 0), 0);
  if (rows.length === 0 || max <= 0) return emptyState(container);

  const peak = rows.reduce((a, r) => ((r.expenseTotal || 0) > (a.expenseTotal || 0) ? r : a), rows[0]);
  const summary = `${monthTitle(rows[0].month)}부터 ${monthTitle(rows[rows.length - 1].month)}까지 월별 수입과 지출. 지출이 가장 큰 달은 ${monthTitle(peak.month)} ${formatWon(peak.expenseTotal || 0)}`;

  const figure = figureShell(title);
  const { svg, defs } = svgShell(VB_W, VB_H, title, summary);
  const incomeFill = addBarPattern(defs, nextId('pt'), 'income'); // 수입 = / 무늬
  const expenseFill = addBarPattern(defs, nextId('pt'), 'expense'); // 지출 = \ 무늬 (같은 밀도: 잉크 양을 맞춘다)
  const sc = drawAxes(svg, rows.map((r) => r.month), max);
  const lay = barLayout(rows.length, 2, PLOT_W, { groupGap: 0.25, barGap: 1 });
  rows.forEach((r, g) => {
    [[r.incomeTotal, incomeFill], [r.expenseTotal, expenseFill]].forEach(([v, fill], si) => {
      const hgt = barHeight(v || 0, sc.max, PLOT_H);
      if (hgt <= 0) return;
      const b = lay.bars[g * 2 + si];
      svg.appendChild(s('rect', { x: M.left + b.x, y: M.top + PLOT_H - hgt, width: b.width, height: hgt, fill, class: 'chart-stroke' }));
    });
  });

  const body = h('div', { class: 'chart-body' });
  body.appendChild(svg);
  const legend = h('ul', { class: 'legend legend-inline' });
  legend.appendChild(legendItem(patternSwatch(incomeFill), '수입 (/ 무늬)'));
  legend.appendChild(legendItem(patternSwatch(expenseFill), '지출 (\\ 무늬)'));
  body.appendChild(legend);
  figure.appendChild(body);
  figure.appendChild(h('p', { class: 'chart-summary' }, summary));
  figure.appendChild(buildTable(`${title} 표`, '월', ['수입', '지출', '잔액'],
    rows.map((r) => ({
      head: monthTitle(r.month),
      cells: [formatWon(r.incomeTotal || 0), formatWon(r.expenseTotal || 0), formatWon(r.balance ?? ((r.incomeTotal || 0) - (r.expenseTotal || 0)))],
    }))));
  container.replaceChildren(figure);
}

/**
 * 단일 막대: 카테고리별 월 추이.
 * opts: { title, seriesName, months:["YYYY-MM"], totals:[number], viz?, colorIndex=0 }  (api category-monthly 의 한 series)
 * viz: 그 카테고리의 색·무늬 번호(1..8). 없으면 colorIndex 순서로 정한다.
 */
export function renderBars(container, opts) {
  const { title, seriesName, months, totals, colorIndex = 0 } = opts;
  const vizNo = opts.viz >= 1 && opts.viz <= VIZ_COUNT ? opts.viz : (colorIndex % VIZ_COUNT) + 1;
  const labels = Array.isArray(months) ? months : [];
  const vals = labels.map((_, i) => (Number.isFinite(totals?.[i]) ? totals[i] : 0));
  const max = vals.reduce((m, v) => Math.max(m, v), 0);
  if (labels.length === 0 || max <= 0) return emptyState(container);

  const sum = vals.reduce((a, v) => a + v, 0);
  const peakIdx = vals.indexOf(max);
  const summary = `${seriesName} 월별 합계 ${formatWon(sum)}. 가장 큰 달은 ${monthTitle(labels[peakIdx])} ${formatWon(max)} (${formatPercent(ratioOf(max, sum))})`;

  const figure = figureShell(title);
  const { svg, defs } = svgShell(VB_W, VB_H, title, summary);
  const fillAttr = vizNo === 1 ? { class: 'viz-fill-1 chart-stroke' } : { fill: addVizPattern(defs, nextId('pt'), vizNo), class: 'chart-stroke' };
  const sc = drawAxes(svg, labels, max);
  const lay = barLayout(labels.length, 1, PLOT_W, { groupGap: 0.3 });
  vals.forEach((v, i) => {
    const hgt = barHeight(v, sc.max, PLOT_H);
    if (hgt <= 0) return;
    const b = lay.bars[i];
    svg.appendChild(s('rect', { x: M.left + b.x, y: M.top + PLOT_H - hgt, width: b.width, height: hgt, ...fillAttr }));
  });

  const body = h('div', { class: 'chart-body' });
  body.appendChild(svg);
  const legend = h('ul', { class: 'legend legend-inline' });
  legend.appendChild(legendItem(swatch(vizNo), seriesName));
  body.appendChild(legend);
  figure.appendChild(body);
  figure.appendChild(h('p', { class: 'chart-summary' }, summary));
  figure.appendChild(buildTable(`${title} 표`, '월', [seriesName],
    labels.map((m, i) => ({ head: monthTitle(m), cells: [formatWon(vals[i])] })),
    { head: '합계', cells: [formatWon(sum)] }));
  container.replaceChildren(figure);
}
