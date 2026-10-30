// 카테고리 사용 이력 화면 (#history). 기록 탭의 카테고리 막대 행에서 들어온다.
// 상태·순서·이어 붙이기는 lib/history-data.js 의 스토어가 맡고, 여기서는 그리기와 포커스만 한다.
// 사용자 입력(카테고리 이름·메모)은 textContent 로만 출력한다.
import { api } from './api.js';
import { el, $, swatch } from './dom.js';
import { formatWon, formatSignedWon } from './lib/money.js';
import { monthTitle } from './lib/date.js';
import { stableVizMap, vizOf } from './lib/viz.js';
import { categoryResponse } from './categories.js';
import {
  createHistoryStore, listView, rowDateLabel, periodLabel, sortAnnounce, moreAnnounce, moreLabel, listCaption,
} from './lib/history-data.js';

const KIND_TEXT = { expense: '지출', income: '수입' };
let selection = null; // { type, category }: 메모리에만 둔다 (새로고침하면 기록 탭으로)
let pendingEdit = null; // 행을 눌러 기록 탭으로 가는 중인 거래
let wasOpen = false;

const store = createHistoryStore(
  (q) => api.categoryHistory(q.type, q.category, { sort: q.sort, cursor: q.cursor, limit: q.limit }),
  (state, event) => render(state, event),
);

/** 기록 탭의 막대 행에서 부른다. 돌아올 때 포커스를 되돌릴 버튼은 data-hist-* 로 다시 찾는다 */
export function openHistory(type, category) {
  selection = { type, category };
  location.hash = 'history';
}

function inactive(sel) {
  const items = categoryResponse() && categoryResponse().items;
  const it = Array.isArray(items) ? items.find((i) => i.type === sel.type && i.name === sel.category) : null;
  return Boolean(it) && !it.active;
}

function renderHead() {
  const sel = store.state.sel;
  if (!sel) return;
  $('hist-title').textContent = sel.category;
  const map = stableVizMap(categoryResponse() && categoryResponse().items, sel.type);
  const parts = [swatch(vizOf(map, sel.category)), el('span', {}, `${KIND_TEXT[sel.type]} 사용 이력`)];
  if (inactive(sel)) parts.push(el('span', { class: 'badge hist-inactive' }, '사용 안 함'));
  $('hist-caption').replaceChildren(...parts);
}

function txRow(t, sort) {
  const date = rowDateLabel(t.date, sort);
  const li = el('li', { class: 'tx-row row' });
  const edit = el('button', {
    type: 'button', class: 'tx-edit',
    'aria-label': `${date} ${t.memo || '메모 없음'} ${formatWon(t.amount)} 수정`,
  });
  const mid = el('span', { class: 'tx-mid' });
  mid.appendChild(el('span', { class: 'hist-date' }, date));
  mid.appendChild(el('span', { class: t.memo ? 'hist-memo' : 'hist-memo hist-memo--none' }, t.memo || '메모 없음'));
  edit.appendChild(mid);
  const side = el('span', { class: 'tx-side' });
  side.appendChild(el('span', { class: `tx-amount ${t.type}` }, formatSignedWon(t.type, t.amount)));
  edit.appendChild(side);
  edit.addEventListener('click', () => editTx(t));
  li.appendChild(edit);
  return li;
}

function renderList(s) {
  const view = listView(s.sort, s.txs, s.summary.months);
  let items;
  if (view.mode === 'grouped') {
    items = view.groups.map((g) => {
      const li = el('li', { class: 'tx-group' });
      const head = el('h3', { class: 'list-head tx-date' });
      head.appendChild(el('span', {}, monthTitle(g.month)));
      head.appendChild(el('span', { class: 'tx-day-sum' }, g.total === null ? '' : `${formatSignedWon(s.sel.type, g.total)} · ${g.count}건`));
      li.appendChild(head);
      const inner = el('ul', { class: 'tx-rows' });
      for (const t of g.items) inner.appendChild(txRow(t, s.sort));
      li.appendChild(inner);
      return li;
    });
  } else {
    items = view.items.map((t) => txRow(t, s.sort));
  }
  $('hist-list').replaceChildren(...items);
  $('hist-list').classList.toggle('hist-flat', view.mode === 'flat');
  $('hist-list-title').textContent = `기록 목록, ${listCaption(s.sort, s.txs.length, s.summary.count)}`;
}

function renderSummary(s) {
  const sum = s.summary;
  const total = $('hist-total');
  total.textContent = formatSignedWon(s.sel.type, sum.total);
  total.className = `sum-balance__value ${s.sel.type === 'income' ? 'amt-income' : 'amt-expense'}`;
  $('hist-count').textContent = `${sum.count}건`;
  $('hist-period').textContent = periodLabel(sum.firstDate, sum.lastDate);
}

function say(text) {
  $('hist-status').textContent = text;
}

function render(s, event) {
  if (!s.sel) return;
  for (const b of $('hist-sort').querySelectorAll('[data-sort]')) b.setAttribute('aria-pressed', String(b.dataset.sort === s.sort));
  const empty = s.status === 'ready' && s.summary && s.summary.count === 0;
  const moreBtn = $('hist-more');
  const hadMoreFocus = document.activeElement === moreBtn;

  if (event === 'error') $('hist-list').replaceChildren();
  if (s.status === 'ready' && !empty && (event === 'open' || event === 'sort' || event === 'retry' || event === 'load' || event === 'more')) {
    renderSummary(s);
    renderList(s);
  }
  const hasRows = $('hist-list').childElementCount > 0;
  $('hist-loading').hidden = !(s.status === 'loading' && !hasRows);
  $('hist-error').hidden = s.status !== 'error';
  $('hist-error-text').textContent = s.status === 'error' ? s.error : '';
  $('hist-empty').hidden = !empty;
  $('hist-summary').hidden = !(s.summary && s.summary.count > 0);
  $('hist-sort').hidden = empty || !(s.summary || s.status === 'error');
  $('hist-card').hidden = !(hasRows && !empty && s.status !== 'error');
  $('hist-card').setAttribute('aria-busy', String(s.status === 'loading'));

  // 더 보기 버튼: 비활성 대신 aria-disabled (포커스를 잃지 않게)
  const loadingMore = s.moreStatus === 'loading';
  moreBtn.hidden = !s.nextCursor;
  moreBtn.textContent = moreLabel(s.txs.length, s.summary ? s.summary.count : s.txs.length);
  moreBtn.setAttribute('aria-disabled', String(loadingMore));
  moreBtn.setAttribute('aria-busy', String(loadingMore));
  $('hist-more-error').textContent = s.moreStatus === 'error' ? s.moreError : '';

  if (event === 'sort') say(sortAnnounce(s.sort, s.summary.count));
  if (event === 'more') {
    say(moreAnnounce(s.added, s.txs.length, s.summary.count));
    if (moreBtn.hidden && hadMoreFocus) {
      // 끝까지 불러와 버튼이 사라지면 새로 붙은 첫 행으로 (포커스가 body 로 가지 않게)
      const rows = $('hist-list').querySelectorAll('.tx-edit');
      (rows[s.txs.length - s.added] || rows[rows.length - 1])?.focus();
    }
  }
}

/** 행을 누르면 기록 탭으로 가서 기존 수정 흐름(record.js 의 startEdit)을 연다. 패널이 보인 다음에 알린다 */
function editTx(tx) {
  pendingEdit = tx;
  location.hash = 'record';
}

function returnFocus() {
  const sel = store.state.sel;
  const btn = sel && [...document.querySelectorAll('#month-summary [data-hist-cat]')]
    .find((b) => b.dataset.histType === sel.type && b.dataset.histCat === sel.category);
  (btn || $('month-title-h')).focus();
}

function onTab(tab) {
  const open = tab === 'history';
  if (open && !wasOpen) {
    if (!selection) { location.replace('#record'); return; } // 선택 없이(새로고침 등) 열렸다
    $('hist-list').replaceChildren();
    $('hist-more-error').textContent = '';
    say('');
    store.open(selection);
    renderHead();
    $('hist-title').focus();
  } else if (!open && wasOpen) {
    store.invalidate(); // 늦게 오는 응답은 버린다
    const tx = pendingEdit;
    pendingEdit = null;
    if (tab === 'record') {
      if (tx) document.dispatchEvent(new CustomEvent('edittx', { detail: tx }));
      else returnFocus();
    }
  }
  wasOpen = open;
}

export function initHistory() {
  for (const b of $('hist-sort').querySelectorAll('[data-sort]')) {
    b.addEventListener('click', () => { $('hist-more-error').textContent = ''; store.setSort(b.dataset.sort); });
  }
  $('hist-more').addEventListener('click', () => store.more());
  $('hist-retry').addEventListener('click', () => store.retry());
  // 이름이 바뀌거나 사용 안 함이 되면 옛 선택은 쓸 수 없다. 단순한 목록 로드는 선택을 지우지 않는다
  document.addEventListener('categorieschanged', (ev) => {
    const d = ev.detail || {};
    if (d.renamed || d.dataChanged) selection = null;
    if (wasOpen) renderHead();
  });
  document.addEventListener('tabchange', (ev) => onTab(ev.detail.tab));
  onTab($('panel-history').hidden ? '' : 'history');
}
