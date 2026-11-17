// 대시보드 예산 카드 그리기. 사용자 입력(이름)은 textContent 로만 출력한다.
import { el, $, swatch } from './dom.js';
import { viewedMonthName } from './lib/dashboard-data.js';
import { formatWon } from './lib/money.js';
import { vizOf } from './lib/viz.js';

/** 막대: 장식이라 aria-hidden. 폭은 CSSOM 으로만 (CSP) */
function bar(percent, over, viz) {
  const track = el('span', { class: over ? 'budget-bar budget-bar--over' : 'budget-bar', 'aria-hidden': 'true' });
  const fill = el('span', { class: 'budget-bar__fill' });
  if (viz !== undefined) fill.setAttribute('data-viz', String(viz));
  fill.style.width = `${percent}%`;
  track.appendChild(fill);
  return track;
}

function remainEl(text, over) {
  const p = el('span', { class: over ? 'budget-remain budget-remain--over' : 'budget-remain' });
  if (over) p.appendChild(el('span', { class: 'icon icon--alert', 'aria-hidden': 'true' }));
  p.appendChild(document.createTextNode(text));
  return p;
}

function rowEl(r, vizMap) {
  const li = el('li', { class: r.over ? 'budget-row budget-row--over' : 'budget-row' });
  li.appendChild(el('span', { class: 'sr-only' }, r.label));
  const vis = el('div', { class: 'budget-row__vis', 'aria-hidden': 'true' });
  const head = el('div', { class: 'budget-row__head' });
  head.appendChild(swatch(vizOf(vizMap, r.name)));
  head.appendChild(el('span', { class: 'budget-row__name' }, r.name));
  head.appendChild(el('span', { class: 'budget-row__amount' }, `${formatWon(r.spent)} / ${formatWon(r.budget)}`));
  vis.appendChild(head);
  vis.appendChild(bar(r.percent, r.over, vizOf(vizMap, r.name)));
  vis.appendChild(remainEl(r.remain, r.over));
  li.appendChild(vis);
  return li;
}

/** card: buildBudgetCard 결과 | null(예산 없음 -> 카드 숨김) */
export function renderBudgetCard(card, base, thisMonth, vizMap) {
  const root = $('budget-card');
  if (!card || !card.rows.length) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  const t = card.total;
  const title = el('h2', { class: 'card-title', id: 'budget-title' }, `${viewedMonthName(base, thisMonth)} 예산`);
  const sum = el('div', { class: t.over ? 'budget-sum budget-sum--over' : 'budget-sum' });
  const line = el('p', { class: 'budget-sum__text' });
  if (t.over) line.appendChild(el('span', { class: 'icon icon--alert', 'aria-hidden': 'true' }));
  line.appendChild(document.createTextNode(t.text));
  sum.appendChild(line);
  sum.appendChild(bar(t.percent, t.over));
  sum.appendChild(el('p', { class: 'caption' }, t.note));
  const list = el('ul', { class: 'budget-list' });
  list.append(...card.rows.map((r) => rowEl(r, vizMap)));
  root.replaceChildren(title, sum, list);
  root.hidden = false;
}
