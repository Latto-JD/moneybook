// SVG 차트 컴포넌트 3종 (도넛, 묶은 막대, 막대). 외부 라이브러리 없음.
// 모든 문자열은 textContent / setAttribute 로만 넣는다 (innerHTML 미사용, 인라인 style 미사용: CSP).
import { formatWon } from './lib/money.js';
import { monthShort, monthTitle } from './lib/date.js';
import {
  donutSegments, formatPercent, niceScale, barHeight, formatTick, labelStep, barLayout, ratioOf,
} from './lib/chart-geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const EMPTY_TEXT = '아직 이 기간에 기록이 없어요';

// 흰 배경 대비 3:1 이상, 색각이상 친화(파랑/주황/청록 계열 위주)
export const PALETTE = ['#0072B2', '#C4500A', '#00875F', '#A8448F', '#7A6200', '#4A4A4A', '#3B6FB6', '#8E5B2E'];
export const PATTERN_KINDS = ['solid', 'diag', 'dots', 'hstripe', 'cross', 'vstripe', 'backdiag', 'grid'];
// "그 외 N개" 묶음 조각 전용 (PALETTE 의 어떤 색과도, 다른 조각의 무늬와도 겹치지 않는다). 흰 배경 대비 4.5:1 이상.
export const OTHER_STYLE = { color: '#6B6B6B', kind: 'checker' };
/** 조각 i 의 (색, 무늬). 묶음 조각이면 전용 조합 */
export function pieceStyle(i, isOther) {
  if (isOther) return OTHER_STYLE;
  return { color: PALETTE[i % PALETTE.length], kind: PATTERN_KINDS[i % PATTERN_KINDS.length] };
}

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

/** <defs> 안에 색 + 무늬 패턴을 추가하고 fill 값을 반환. solid 는 단색 문자열. */
function addPattern(defs, id, color, kind) {
  if (kind === 'solid') return color;
  const p = s('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
  p.appendChild(s('rect', { width: 8, height: 8, fill: color }));
  const mark = { stroke: '#fff', 'stroke-width': 1.6, fill: 'none' };
  switch (kind) {
    case 'diag': p.appendChild(s('path', { ...mark, d: 'M-2 2L2 -2M0 8L8 0M6 10L10 6' })); break;
    case 'backdiag': p.appendChild(s('path', { ...mark, d: 'M-2 6L2 10M0 0L8 8M6 -2L10 2' })); break;
    case 'hstripe': p.appendChild(s('path', { ...mark, d: 'M0 2H8M0 6H8' })); break;
    case 'vstripe': p.appendChild(s('path', { ...mark, d: 'M2 0V8M6 0V8' })); break;
    case 'cross': p.appendChild(s('path', { ...mark, d: 'M0 0L8 8M8 0L0 8' })); break;
    case 'grid': p.appendChild(s('path', { ...mark, d: 'M4 0V8M0 4H8' })); break;
    case 'checker':
      p.appendChild(s('rect', { x: 0, y: 0, width: 4, height: 4, fill: '#fff' }));
      p.appendChild(s('rect', { x: 4, y: 4, width: 4, height: 4, fill: '#fff' }));
      break;
    case 'dots':
      p.appendChild(s('circle', { cx: 2, cy: 2, r: 1.3, fill: '#fff' }));
      p.appendChild(s('circle', { cx: 6, cy: 6, r: 1.3, fill: '#fff' }));
      break;
    default: break;
  }
  defs.appendChild(p);
  return `url(#${id})`;
}

function swatch(fill) {
  // 범례 견본: 같은 문서의 패턴 id 를 참조한다
  const svg = s('svg', { class: 'swatch', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(s('rect', { x: 0.5, y: 0.5, width: 15, height: 15, rx: 2, fill, stroke: '#333', 'stroke-width': 1 }));
  return svg;
}

function emptyState(container) {
  container.replaceChildren(h('p', { class: 'chart-empty', role: 'status' }, EMPTY_TEXT));
}

/** 표 대체. columns: 열 이름 배열, rows: [{head, cells:[string]}], foot: {head, cells}|null */
function buildTable(caption, headLabel, columns, rows, foot) {
  const details = h('details', { class: 'chart-table' });
  details.appendChild(h('summary', {}, '표로 보기'));
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

function legendItem(fill, label, extra) {
  const li = h('li');
  li.appendChild(swatch(fill));
  li.appendChild(h('span', { class: 'legend-label' }, label));
  if (extra) for (const [cls, text] of extra) li.appendChild(h('span', { class: cls }, text));
  return li;
}

/**
 * 도넛. opts: { title, periodLabel, items:[{label,value}], centerLabel='총 지출', noun='지출' }
 * 조각 순서 = 범례 순서 = 금액 내림차순 (12시 방향 시계방향).
 * items 에 { members:[{label,value}], pinLast:true } 인 "그 외 N개" 묶음이 있으면 마지막 조각으로 그리고,
 * 범례에 묶인 이름을 나열하며, 표 대체에는 묶지 않은 전체 행을 싣는다.
 */
export function renderDonut(container, opts) {
  const { title, periodLabel = '', items, centerLabel = '총 지출', noun = '지출' } = opts;
  const segs = donutSegments(items, { cx: 100, cy: 100, outerR: 92, innerR: 56 });
  if (segs.length === 0) return emptyState(container);
  const total = segs.reduce((a, x) => a + x.value, 0);
  const top = segs[0];
  const summary = `${periodLabel ? periodLabel + ' ' : ''}${noun} ${formatWon(total)} 중 ${top.label} ${formatPercent(top.ratio)}로 가장 큼`;

  const figure = figureShell(title);
  const { svg, defs } = svgShell(200, 200, title, summary);
  const fills = segs.map((seg, i) => {
    const st = pieceStyle(i, Array.isArray(seg.members));
    return addPattern(defs, nextId('pt'), st.color, st.kind);
  });
  segs.forEach((seg, i) => {
    svg.appendChild(s('path', { d: seg.path, fill: fills[i], stroke: '#fff', 'stroke-width': 1.5, 'fill-rule': 'evenodd' }));
  });
  svg.appendChild(s('text', { x: 100, y: 94, 'text-anchor': 'middle', class: 'chart-text chart-text-sub' }, centerLabel));
  svg.appendChild(s('text', { x: 100, y: 114, 'text-anchor': 'middle', class: 'chart-text chart-text-strong' }, formatWon(total)));

  const body = h('div', { class: 'chart-body donut-body' });
  body.appendChild(svg);
  const legend = h('ol', { class: 'legend legend-list' });
  segs.forEach((seg, i) => {
    const li = legendItem(fills[i], seg.label, [['legend-amount', formatWon(seg.value)], ['legend-ratio', formatPercent(seg.ratio)]]);
    if (Array.isArray(seg.members)) li.appendChild(h('span', { class: 'legend-members' }, seg.members.map((m) => m.label).join(', ')));
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
    svg.appendChild(s('line', { x1: M.left, x2: VB_W - M.right, y1: y, y2: y, stroke: t === 0 ? '#555' : '#d0d4da', 'stroke-width': 1 }));
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
  const incomeFill = addPattern(defs, nextId('pt'), PALETTE[0], 'diag'); // 수입 = / 무늬
  const expenseFill = addPattern(defs, nextId('pt'), PALETTE[1], 'backdiag'); // 지출 = \ 무늬 (같은 밀도: 잉크 양을 맞춘다)
  const sc = drawAxes(svg, rows.map((r) => r.month), max);
  const lay = barLayout(rows.length, 2, PLOT_W, { groupGap: 0.25, barGap: 1 });
  rows.forEach((r, g) => {
    [[r.incomeTotal, incomeFill], [r.expenseTotal, expenseFill]].forEach(([v, fill], si) => {
      const hgt = barHeight(v || 0, sc.max, PLOT_H);
      if (hgt <= 0) return;
      const b = lay.bars[g * 2 + si];
      svg.appendChild(s('rect', { x: M.left + b.x, y: M.top + PLOT_H - hgt, width: b.width, height: hgt, fill, stroke: '#333', 'stroke-width': 0.8 }));
    });
  });

  const body = h('div', { class: 'chart-body' });
  body.appendChild(svg);
  const legend = h('ul', { class: 'legend legend-inline' });
  legend.appendChild(legendItem(incomeFill, '수입 (/ 무늬)'));
  legend.appendChild(legendItem(expenseFill, '지출 (\\ 무늬)'));
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
 * opts: { title, seriesName, months:["YYYY-MM"], totals:[number], colorIndex=0 }  (api category-monthly 의 한 series)
 */
export function renderBars(container, opts) {
  const { title, seriesName, months, totals, colorIndex = 0 } = opts;
  const labels = Array.isArray(months) ? months : [];
  const vals = labels.map((_, i) => (Number.isFinite(totals?.[i]) ? totals[i] : 0));
  const max = vals.reduce((m, v) => Math.max(m, v), 0);
  if (labels.length === 0 || max <= 0) return emptyState(container);

  const sum = vals.reduce((a, v) => a + v, 0);
  const peakIdx = vals.indexOf(max);
  const summary = `${seriesName} 월별 합계 ${formatWon(sum)}. 가장 큰 달은 ${monthTitle(labels[peakIdx])} ${formatWon(max)} (${formatPercent(ratioOf(max, sum))})`;

  const figure = figureShell(title);
  const { svg, defs } = svgShell(VB_W, VB_H, title, summary);
  const fill = addPattern(defs, nextId('pt'), PALETTE[colorIndex % PALETTE.length], 'solid');
  const sc = drawAxes(svg, labels, max);
  const lay = barLayout(labels.length, 1, PLOT_W, { groupGap: 0.3 });
  vals.forEach((v, i) => {
    const hgt = barHeight(v, sc.max, PLOT_H);
    if (hgt <= 0) return;
    const b = lay.bars[i];
    svg.appendChild(s('rect', { x: M.left + b.x, y: M.top + PLOT_H - hgt, width: b.width, height: hgt, fill, stroke: '#333', 'stroke-width': 0.8 }));
  });

  const body = h('div', { class: 'chart-body' });
  body.appendChild(svg);
  const legend = h('ul', { class: 'legend legend-inline' });
  legend.appendChild(legendItem(fill, seriesName));
  body.appendChild(legend);
  figure.appendChild(body);
  figure.appendChild(h('p', { class: 'chart-summary' }, summary));
  figure.appendChild(buildTable(`${title} 표`, '월', [seriesName],
    labels.map((m, i) => ({ head: monthTitle(m), cells: [formatWon(vals[i])] })),
    { head: '합계', cells: [formatWon(sum)] }));
  container.replaceChildren(figure);
}
