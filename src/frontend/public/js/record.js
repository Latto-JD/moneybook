// 기록 탭: 입력 폼(F5), 빠른 입력 칩/자동완성(F7), 이번 달 영역(F6), 인사이트(F8)
import { api } from './api.js';
import { el, $, chipItem, keepFocus } from './dom.js';
import { formatWon, formatAmountInput } from './lib/money.js';
import { todayLocal, monthOf, shiftMonth, monthTitle, dayLabel } from './lib/date.js';
import { validateTransaction } from './lib/validate.js';
import { loadCategories, activeCategories, categoryStatus, categoryError, categoryResponse } from './categories.js';
import { inactiveChipLabel } from './lib/categories-data.js';
import { formatPercent } from './lib/chart-geometry.js';
import { shouldSubmitOnChipEnter } from './lib/chip-keys.js';
import { debounce }from './lib/debounce.js';
import { buildInsightSections, INSIGHT_EMPTY_TEXT } from './lib/insight-text.js';

const today = () => todayLocal();
const state = {
  type: 'expense',
  category: '',
  date: today(),
  month: monthOf(today()),
  editingId: null,
  orig: null, // 수정 중인 거래의 원래 { type, category }
  legacy: null, // orig 의 카테고리가 사용 안 함일 때만 orig 와 같음 (그대로 두면 저장할 수 있다)
  txs: [],
  incomeCats: [], // 이번 달 stats/categories?type=income 의 items
};

const cats = () => activeCategories()[state.type];
/** 폼의 현재 유형 (카테고리 관리 화면의 초기 탭) */
export const currentFormType = () => state.type;
const errMsg = (e) => (e && e.message) || '요청을 처리하지 못했어요.';
let flashTimer = null;
function flash(text) {
  const f = $('flash');
  f.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { f.textContent = ''; }, 4000);
}
export function notifyChanged() {
  document.dispatchEvent(new CustomEvent('datachanged'));
}

// ---------------- 입력 폼 ----------------
function clearFieldErrors() {
  for (const id of ['amount', 'category', 'memo', 'date', 'tx']) $(`${id}-error`).textContent = '';
  for (const id of ['amount', 'memo', 'date']) $(id).removeAttribute('aria-invalid');
}
function showFieldErrors(errors) {
  for (const [k, v] of Object.entries(errors)) {
    const target = $(`${k === 'type' ? 'tx' : k}-error`);
    if (target) target.textContent = v;
    if ($(k) && ['amount', 'memo', 'date'].includes(k)) $(k).setAttribute('aria-invalid', 'true');
  }
}

function renderTypeButtons() {
  $('type-expense').setAttribute('aria-pressed', String(state.type === 'expense'));
  $('type-income').setAttribute('aria-pressed', String(state.type === 'income'));
}
function renderCategoryChips() {
  const ul = $('category-chips');
  if (!categoryResponse()) {
    // 아직 못 받았다: 칩 대신 상태 문구 (실패하면 다시 시도)
    if (categoryStatus() === 'error') {
      const li = el('li', { class: 'chip-status' });
      li.appendChild(el('span', { class: 'error-text' }, categoryError()));
      const retry = el('button', { type: 'button', class: 'btn' }, '다시 시도');
      retry.addEventListener('click', () => loadCategories());
      li.appendChild(retry);
      ul.replaceChildren(li);
    } else {
      ul.replaceChildren(el('li', { class: 'hint chip-status' }, '카테고리를 불러오는 중이에요'));
    }
    return;
  }
  const chips = cats().map((c) => chipItem(c, {
    pressed: state.category === c,
    onClick: () => { state.category = c; $('category-error').textContent = ''; keepFocus(ul, renderCategoryChips); },
  }));
  if (state.legacy && state.legacy.type === state.type && state.legacy.category === state.category && !cats().includes(state.category)) {
    // 사용 안 함으로 바꾼 카테고리의 거래를 고칠 때: 선택된 상태로 보여 준다. 다른 칩을 고르면 사라진다.
    chips.push(chipItem(inactiveChipLabel(state.category), { pressed: true, onClick: () => {} }));
  }
  ul.replaceChildren(...chips);
}

/** 수정 중인 거래의 원래 카테고리가 지금 사용 안 함이면 legacy 로 기억한다 */
function syncLegacy() {
  const o = state.editingId && categoryResponse() ? state.orig : null;
  state.legacy = o && !(activeCategories()[o.type] || []).includes(o.category) ? { ...o } : null;
}

/** 카테고리 목록이 바뀌었을 때: 칩을 다시 그리고, 더 못 고르는 선택은 해제한다 */
function onCategoriesChanged(ev) {
  const { renamed, dataChanged } = ev.detail || {};
  if (renamed) {
    if (state.type === renamed.type && state.category === renamed.from) state.category = renamed.to;
    if (state.orig && state.orig.type === renamed.type && state.orig.category === renamed.from) state.orig.category = renamed.to;
  }
  if (categoryResponse()) {
    syncLegacy();
    const keep = state.legacy && state.legacy.type === state.type && state.legacy.category === state.category;
    if (state.category && !cats().includes(state.category) && !keep) state.category = '';
  }
  renderCategoryChips();
  if (dataChanged) refreshAll(); // 이름이 바뀐 거래·집계·추천을 다시 받는다
}
function renderDateSummary() {
  $('date-summary').textContent = state.date === today() ? '오늘' : (dayLabel(state.date, today()) || state.date);
}

function setType(type) {
  if (state.type === type) return;
  state.type = type;
  state.category = '';
  renderTypeButtons();
  renderCategoryChips();
  clearSuggestions();
  loadQuick();
}

function resetForm({ keepFocus: focusAmount = true } = {}) {
  if (state.editingId) { state.date = today(); $('date').value = today(); renderDateSummary(); } // 수정하던 거래의 날짜가 다음 입력에 새지 않게
  state.editingId = null;
  state.orig = null;
  state.legacy = null;
  state.category = '';
  $('amount').value = '';
  $('memo').value = '';
  clearFieldErrors();
  clearSuggestions();
  renderCategoryChips();
  $('save-btn').textContent = '저장';
  $('cancel-edit-btn').hidden = true;
  if (focusAmount) $('amount').focus();
}

// D2: 저장 진행 중 플래그. 버튼 disabled 는 requestSubmit()/Enter 경로를 막지 못하므로 모든 제출 경로가 여기서 걸러진다.
let submitting = false;

async function onSubmit(ev) {
  ev.preventDefault();
  if (submitting) return;
  clearFieldErrors();
  const v = validateTransaction({
    type: state.type, amount: $('amount').value, category: state.category, memo: $('memo').value, date: state.date,
  }, activeCategories(), state.legacy);
  if (!v.ok) {
    showFieldErrors(v.errors);
    const first = ['amount', 'category', 'memo', 'date'].find((k) => v.errors[k]);
    if (first === 'amount' || first === 'memo') $(first).focus();
    else if (first === 'category') $('category-chips').querySelector('button')?.focus();
    return;
  }
  const btn = $('save-btn');
  submitting = true;
  btn.disabled = true;
  try {
    const editing = state.editingId;
    const saved = editing
      ? await api.updateTransaction(editing, v.value)
      : await api.createTransaction(v.value);
    const savedMonth = monthOf(saved && saved.date ? saved.date : v.value.date);
    state.month = savedMonth;
    resetForm();
    flash(editing ? '수정했어요' : '저장했어요');
    await refreshAll();
    notifyChanged();
  } catch (e) {
    if (e.fields) showFieldErrors(e.fields);
    $('tx-error').textContent = errMsg(e);
  } finally {
    submitting = false;
    btn.disabled = false;
  }
}

function startEdit(tx) {
  state.editingId = tx.id;
  state.type = tx.type;
  state.category = tx.category;
  state.date = tx.date;
  state.orig = { type: tx.type, category: tx.category };
  syncLegacy();
  renderTypeButtons();
  renderCategoryChips();
  $('amount').value = formatAmountInput(String(tx.amount));
  $('memo').value = tx.memo || '';
  $('date').value = tx.date;
  renderDateSummary();
  clearFieldErrors();
  clearSuggestions();
  $('save-btn').textContent = '수정 저장';
  $('cancel-edit-btn').hidden = false;
  $('tx-form').scrollIntoView({ block: 'start' });
  $('amount').focus();
}

// ---------------- R1 빠른 입력 / R2 자동완성 ----------------
let quickSeq = 0;
async function loadQuick() {
  const seq = ++quickSeq;
  const section = $('quick-section');
  try {
    const { items } = await api.quick(state.type, today());
    if (seq !== quickSeq) return;
    const list = Array.isArray(items) ? items : [];
    section.hidden = list.length === 0;
    $('quick-chips').replaceChildren(...list.map((it) => chipItem(
      `${it.memo} ${formatWon(it.amount)}${it.weekdayMatch ? ' (이 요일)' : ''}`,
      {
        ariaLabel: `${it.memo} ${it.category} ${formatWon(it.amount)} 채우기${it.weekdayMatch ? ', 이 요일에 자주 해요' : ''}`,
        onClick: () => applySuggestion(it, true),
      },
    )));
  } catch {
    if (seq === quickSeq) section.hidden = true; // 추천 실패는 입력을 막지 않는다
  }
}

function applySuggestion(it, focusSave) {
  if (it.category && cats().includes(it.category)) state.category = it.category; // category 가 null 이면 비워 둔다
  $('memo').value = it.memo;
  $('amount').value = formatAmountInput(String(it.amount));
  $('category-error').textContent = '';
  $('amount-error').textContent = '';
  renderCategoryChips();
  clearSuggestions();
  if (focusSave) $('save-btn').focus();
  else $('amount').focus();
}

let acSeq = 0;
function clearSuggestions() {
  acSeq++;
  autocomplete.cancel();
  $('memo-suggestions').replaceChildren();
}
const autocomplete = debounce(async () => {
  const q = $('memo').value.trim();
  const seq = ++acSeq;
  if (!q) { $('memo-suggestions').replaceChildren(); return; }
  try {
    const { items } = await api.autocomplete(q, state.type, today());
    if (seq !== acSeq) return; // 오래된 응답 무시
    $('memo-suggestions').replaceChildren(...(items || []).map((it) => chipItem(
      it.category ? `${it.memo} · ${it.category} · ${formatWon(it.amount)}` : `${it.memo} · ${formatWon(it.amount)}`,
      { ariaLabel: it.category ? `${it.memo}, ${it.category}, ${formatWon(it.amount)} 선택` : `${it.memo}, ${formatWon(it.amount)} 선택`, onClick: () => applySuggestion(it, false) },
    )));
  } catch {
    if (seq === acSeq) $('memo-suggestions').replaceChildren();
  }
}, 200);

// ---------------- 이번 달 영역 ----------------
function renderCategoryBlock(title, list, kind) {
  const parts = [el('h3', {}, title)];
  if (!list.length) {
    parts.push(el('p', { class: 'hint empty-line' }, `이 달에는 ${kind === 'income' ? '수입' : '지출'} 기록이 없어요`));
    return parts;
  }
  const ul = el('ul', { class: 'cat-bars' });
  for (const c of list) {
    const li = el('li');
    const head = el('div', { class: 'cat-bar-head' });
    head.appendChild(el('span', { class: 'cat-bar-name' }, c.category));
    head.appendChild(el('span', { class: 'cat-bar-amount' }, `${formatWon(c.total)} (${formatPercent(c.ratio || 0)})`));
    li.appendChild(head);
    const track = el('div', { class: 'bar-track', 'aria-hidden': 'true' });
    const fill = el('div', { class: `bar-fill ${kind}` });
    fill.style.width = `${Math.min(100, Math.max(0, (c.ratio || 0) * 100)).toFixed(1)}%`;
    track.appendChild(fill);
    li.appendChild(track);
    ul.appendChild(li);
  }
  parts.push(ul);
  return parts;
}

function renderMonthSummary(s, incomeItems) {
  const box = $('month-summary');
  const kpi = (label, value) => {
    const d = el('div', { class: 'kpi' });
    d.appendChild(el('div', { class: 'kpi-label' }, label));
    d.appendChild(el('div', { class: 'kpi-value' }, value));
    return d;
  };
  const grid = el('div', { class: 'kpi-grid kpi-grid-3' });
  grid.appendChild(kpi('수입', formatWon(s.incomeTotal)));
  grid.appendChild(kpi('지출', formatWon(s.expenseTotal)));
  grid.appendChild(kpi('잔액', formatWon(s.balance)));
  const parts = [grid];

  // 수입 -> 지출 순 (요약·표와 같은 순서). 한쪽이 비어도 같은 형식의 빈 상태 문구를 보인다.
  const income = Array.isArray(incomeItems) ? incomeItems : [];
  const expense = Array.isArray(s.byCategory) ? s.byCategory : [];
  parts.push(...renderCategoryBlock('카테고리별 수입', income, 'income'));
  parts.push(...renderCategoryBlock('카테고리별 지출', expense, 'expense'));
  box.replaceChildren(...parts);
}

function renderTxList(txs) {
  const ul = $('tx-list');
  if (!txs.length) {
    ul.replaceChildren(el('li', { class: 'hint empty-line' }, '이 달에는 아직 기록이 없어요'));
    return;
  }
  const groups = new Map();
  for (const t of txs) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  const items = [];
  for (const [date, list] of groups) {
    const li = el('li', { class: 'tx-group' });
    li.appendChild(el('h3', { class: 'tx-date' }, dayLabel(date, today()) || date));
    const inner = el('ul', { class: 'tx-rows' });
    for (const t of list) inner.appendChild(txRow(t));
    li.appendChild(inner);
    items.push(li);
  }
  ul.replaceChildren(...items);
}

function txRow(t) {
  const kind = t.type === 'income' ? '수입' : '지출';
  const sign = t.type === 'income' ? '+' : '-';
  const li = el('li', { class: 'tx-row' });
  const edit = el('button', {
    type: 'button', class: 'tx-edit',
    'aria-label': `${kind} ${t.category} ${t.memo || ''} ${formatWon(t.amount)} 수정`.replace(/\s+/g, ' '),
  });
  edit.appendChild(el('span', { class: 'tx-kind' }, kind));
  const mid = el('span', { class: 'tx-mid' });
  mid.appendChild(el('span', { class: 'tx-cat' }, t.category));
  if (t.memo) mid.appendChild(el('span', { class: 'tx-memo' }, t.memo));
  edit.appendChild(mid);
  edit.appendChild(el('span', { class: `tx-amount ${t.type}` }, `${sign}${formatWon(t.amount)}`));
  edit.addEventListener('click', () => startEdit(t));
  const del = el('button', {
    type: 'button', class: 'btn btn-danger tx-del',
    'aria-label': `${t.category} ${t.memo || ''} ${formatWon(t.amount)} 삭제`.replace(/\s+/g, ' '),
  }, '삭제');
  del.addEventListener('click', () => onDelete(t));
  li.appendChild(edit);
  li.appendChild(del);
  return li;
}

let deleting = false;
async function onDelete(t) {
  if (deleting) return;
  const label = `${t.category}${t.memo ? ` ${t.memo}` : ''} ${formatWon(t.amount)}`;
  deleting = true;
  try {
    if (!window.confirm(`${label} 기록을 삭제할까요?`)) return;
    await api.deleteTransaction(t.id);
    if (state.editingId === t.id) resetForm({ keepFocus: false });
    flash('삭제했어요');
    const rows = [...$('tx-list').querySelectorAll('.tx-edit')];
    const at = rows.findIndex((b) => b.closest('.tx-row') === document.activeElement.closest('.tx-row'));
    await refreshAll();
    notifyChanged();
    // 삭제한 행이 사라져 포커스가 body 로 가는 것을 막는다: 같은 자리의 다음 행, 없으면 월 제목
    const after = [...$('tx-list').querySelectorAll('.tx-edit')];
    (after[Math.min(Math.max(at, 0), after.length - 1)] || $('month-title-h')).focus();
  } catch (e) {
    flash('');
    $('month-error').textContent = errMsg(e);
  } finally {
    deleting = false;
  }
}

let monthSeq = 0;
async function loadMonth() {
  const seq = ++monthSeq;
  const month = state.month;
  $('month-title-h').textContent = monthTitle(month) + (month === monthOf(today()) ? ' (이번 달)' : '');
  $('month-error').textContent = '';
  try {
    const [txRes, sum, inc] = await Promise.all([
      api.listTransactions(month), api.summary(month), api.statsCategories(month, month, 'income'),
    ]);
    if (seq !== monthSeq) return;
    state.txs = txRes.transactions || [];
    renderMonthSummary(sum, inc && inc.items);
    renderTxList(state.txs);
  } catch (e) {
    if (seq === monthSeq) $('month-error').textContent = errMsg(e);
  }
}

// ---------------- 인사이트 ----------------
let insightSeq = 0;
async function loadInsights() {
  const seq = ++insightSeq;
  const box = $('insights');
  try {
    const data = await api.insights(state.month, today());
    if (seq !== insightSeq) return;
    const sections = buildInsightSections(data);
    if (!sections.length) {
      box.replaceChildren(el('p', { class: 'hint' }, INSIGHT_EMPTY_TEXT));
      return;
    }
    box.replaceChildren(...sections.map((sec) => {
      const wrap = el('div', { class: `insight-section insight-${sec.key}` });
      wrap.appendChild(el('h3', {}, sec.title));
      const ul = el('ul', { class: 'insight-list' });
      for (const line of sec.lines) {
        const li = el('li', { class: line.strong ? 'insight strong' : 'insight' });
        li.appendChild(el('span', { class: 'insight-icon', 'aria-hidden': 'true' }, line.icon));
        li.appendChild(el('span', { class: 'insight-label' }, line.label));
        li.appendChild(el('span', { class: 'insight-text' }, line.text));
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      return wrap;
    }));
  } catch (e) {
    if (seq === insightSeq) box.replaceChildren(el('p', { class: 'error-text' }, errMsg(e)));
  }
}

async function refreshAll() {
  await Promise.all([loadMonth(), loadInsights(), loadQuick()]);
}

function moveMonth(delta) {
  const next = shiftMonth(state.month, delta);
  if (!next) return;
  state.month = next;
  loadMonth();
  loadInsights();
}

export function initRecord() {
  $('amount').addEventListener('input', (ev) => {
    ev.target.value = formatAmountInput(ev.target.value);
    $('amount-error').textContent = '';
  });
  // C29: 선택된 칩에서 Enter 를 다시 누르면 저장 (칩 클릭 직후 Enter). 선택 전 Enter/Space 는 기본 동작(선택).
  $('category-chips').addEventListener('keydown', (ev) => {
    const btn = ev.target.closest && ev.target.closest('button');
    if (!btn) return;
    if (shouldSubmitOnChipEnter({
      key: ev.key, pressed: btn.getAttribute('aria-pressed') === 'true', isComposing: ev.isComposing, repeat: ev.repeat,
    })) {
      ev.preventDefault();
      $('tx-form').requestSubmit();
    }
  });
  $('type-expense').addEventListener('click', () => setType('expense'));
  $('type-income').addEventListener('click', () => setType('income'));
  $('memo').addEventListener('input', () => { $('memo-error').textContent = ''; autocomplete(); });
  $('memo').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') clearSuggestions(); });
  $('date').value = state.date;
  $('date').addEventListener('change', (ev) => {
    if (ev.target.value) state.date = ev.target.value;
    renderDateSummary();
  });
  $('tx-form').addEventListener('submit', onSubmit);
  $('cancel-edit-btn').addEventListener('click', () => resetForm());
  $('month-prev').addEventListener('click', () => moveMonth(-1));
  $('month-next').addEventListener('click', () => moveMonth(1));

  document.addEventListener('categorieschanged', onCategoriesChanged);
  renderTypeButtons();
  renderCategoryChips();
  renderDateSummary();
  loadCategories();
  refreshAll();
  if (!$('panel-record').hidden) $('amount').focus();
}
