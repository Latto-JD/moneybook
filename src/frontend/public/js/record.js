// 기록 탭: 입력 폼(F5), 빠른 입력 칩/자동완성(F7), 이번 달 영역(F6), 인사이트(F8)
import { api } from './api.js';
import { el, $, chipItem, keepFocus, swatch } from './dom.js';
import { formatWon, formatAmountInput, parseAmount, addToAmount, formatSignedWon, formatBalanceWon } from './lib/money.js';
import { todayLocal, monthOf, shiftMonth, monthTitle, dayLabel, longDayLabel } from './lib/date.js';
import { validateTransaction, AMOUNT_RANGE_TEXT } from './lib/validate.js';
import { stableVizMap, vizOf } from './lib/viz.js';
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
/** 유형별 카테고리 색·무늬 번호표 (목록 순서 기준, lib/viz.js) */
const vizMap = (type) => stableVizMap(categoryResponse() && categoryResponse().items, type);
const KIND_TEXT = { expense: '지출', income: '수입' };
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

/**
 * 저장 버튼 라벨: "지출 저장 · 12,500원" / "수입 저장 · …" / "수정 저장 · …".
 * 금액이 없으면 비활성 모양(aria-disabled)이지만 눌러도 막지 않는다: 금액 오류를 보여 주고 포커스를 금액칸으로 옮기기 위해서다.
 */
function updateSaveLabel() {
  const n = parseAmount($('amount').value);
  const base = state.editingId ? '수정 저장' : `${KIND_TEXT[state.type]} 저장`;
  $('save-btn').textContent = n === null ? base : `${base} · ${formatWon(n)}`;
  $('save-btn').setAttribute('aria-disabled', String(n === null));
}

function renderTypeButtons() {
  $('type-expense').setAttribute('aria-pressed', String(state.type === 'expense'));
  $('type-income').setAttribute('aria-pressed', String(state.type === 'income'));
  updateSaveLabel();
}
function renderCategoryChips() {
  const ul = $('category-chips');
  if (!categoryResponse()) {
    // 아직 못 받았다: 칩 대신 상태 문구 (실패하면 다시 시도)
    if (categoryStatus() === 'error') {
      const li = el('li', { class: 'chip-status' });
      li.appendChild(el('span', { class: 'error-text' }, categoryError()));
      const retry = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, '다시 시도');
      retry.addEventListener('click', () => loadCategories());
      li.appendChild(retry);
      ul.replaceChildren(li);
    } else {
      ul.replaceChildren(el('li', { class: 'hint chip-status' }, '카테고리를 불러오는 중이에요'));
    }
    return;
  }
  const map = vizMap(state.type);
  const chips = cats().map((c) => chipItem(c, {
    pressed: state.category === c,
    viz: vizOf(map, c),
    onClick: () => { state.category = c; $('category-error').textContent = ''; keepFocus(ul, renderCategoryChips); },
  }));
  if (state.legacy && state.legacy.type === state.type && state.legacy.category === state.category && !cats().includes(state.category)) {
    // 사용 안 함으로 바꾼 카테고리의 거래를 고칠 때: 선택된 상태로 보여 준다. 다른 칩을 고르면 사라진다.
    chips.push(chipItem(inactiveChipLabel(state.category), { pressed: true, viz: vizOf(map, state.category), onClick: () => {} }));
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
  else if (state.txs.length) renderTxList(state.txs); // 목록 행의 견본 번호만 다시
}
function renderDateSummary() {
  $('date-summary').textContent = state.date === today() ? '오늘' : (dayLabel(state.date, today()) || state.date);
}

/** 빠른 금액 칩: 눌렀을 때 입력 값에 더한다. 1억을 넘으면 1억에서 멈추고 오류 문구를 보인다. */
function addAmount(delta) {
  const { value, capped } = addToAmount($('amount').value, delta);
  $('amount').value = formatAmountInput(String(value));
  $('amount-error').textContent = capped ? AMOUNT_RANGE_TEXT : '';
  if (capped) $('amount').setAttribute('aria-invalid', 'true');
  else $('amount').removeAttribute('aria-invalid');
  updateSaveLabel();
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

function resetForm({ keepFocus: focusAmount = true, keepCategory = false } = {}) {
  if (state.editingId) { state.date = today(); $('date').value = today(); renderDateSummary(); } // 수정하던 거래의 날짜가 다음 입력에 새지 않게
  state.editingId = null;
  state.orig = null;
  state.legacy = null;
  if (!keepCategory) state.category = ''; // 새 기록을 저장한 뒤에는 같은 카테고리를 이어서 입력하기 쉽게 유지한다
  $('amount').value = '';
  $('memo').value = '';
  clearFieldErrors();
  clearSuggestions();
  renderCategoryChips();
  updateSaveLabel();
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
    resetForm({ keepCategory: !editing });
    flash(editing ? '수정했어요' : '저장했어요');
    await refreshAll();
    notifyChanged();
  } catch (e) {
    if (e.fields) showFieldErrors(e.fields);
    $('tx-error').textContent = errMsg(e);
  } finally {
    submitting = false;
    btn.disabled = false;
    updateSaveLabel();
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
  updateSaveLabel();
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
  $('amount').removeAttribute('aria-invalid');
  renderCategoryChips();
  updateSaveLabel();
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

/** 수입·지출 같은 크기의 두 칸 + 남은 돈 한 줄 */
function renderMonthTotals(s) {
  const box = $('month-totals');
  const prefix = state.month === monthOf(today()) ? '이번 달' : monthTitle(state.month);
  const cell = (kind, value) => {
    const label = `${prefix} ${KIND_TEXT[kind]}`;
    const d = el('div', { class: 'sum-cell' });
    const head = el('div', { class: `sum-cell__label amt-${kind}` });
    head.appendChild(el('span', { class: `icon icon--${kind}`, 'aria-hidden': 'true' }));
    head.appendChild(document.createTextNode(label));
    d.appendChild(head);
    d.appendChild(el('div', { class: `sum-cell__value figure amt-${kind}`, 'aria-label': `${label} ${formatWon(value)}` }, formatWon(value)));
    return d;
  };
  const rest = formatBalanceWon(s.balance);
  box.replaceChildren(
    cell('income', s.incomeTotal),
    cell('expense', s.expenseTotal),
    el('p', { class: 'caption summary-note' }, `남은 돈 ${rest}`),
  );
}

function renderMonthSummary(s, incomeItems) {
  renderMonthTotals(s);
  // 수입 -> 지출 순 (요약·표와 같은 순서). 한쪽이 비어도 같은 형식의 빈 상태 문구를 보인다.
  const income = Array.isArray(incomeItems) ? incomeItems : [];
  const expense = Array.isArray(s.byCategory) ? s.byCategory : [];
  $('month-summary').replaceChildren(
    ...renderCategoryBlock('카테고리별 수입', income, 'income'),
    ...renderCategoryBlock('카테고리별 지출', expense, 'expense'),
  );
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
  const maps = { expense: vizMap('expense'), income: vizMap('income') };
  const items = [];
  for (const [date, list] of groups) {
    const li = el('li', { class: 'tx-group' });
    const head = el('h3', { class: 'list-head tx-date' });
    head.appendChild(el('span', {}, dayLabel(date, today()) || date));
    head.appendChild(el('span', { class: 'tx-day-sum' }, daySum(list)));
    li.appendChild(head);
    const inner = el('ul', { class: 'tx-rows' });
    for (const t of list) inner.appendChild(txRow(t, maps[t.type]));
    li.appendChild(inner);
    items.push(li);
  }
  ul.replaceChildren(...items);
}

/** 그날 합계 머리줄: "수입 +30,000원 · 지출 −12,500원" (0 인 쪽은 생략) */
function daySum(list) {
  const sum = (type) => list.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
  const inc = sum('income');
  const exp = sum('expense');
  return [inc > 0 && `수입 ${formatSignedWon('income', inc)}`, exp > 0 && `지출 ${formatSignedWon('expense', exp)}`].filter(Boolean).join(' · ');
}

function txRow(t, map) {
  const kind = KIND_TEXT[t.type];
  const li = el('li', { class: 'tx-row row' });
  const edit = el('button', {
    type: 'button', class: 'tx-edit',
    'aria-label': `${kind} ${t.category} ${t.memo || ''} ${formatWon(t.amount)} 수정`.replace(/\s+/g, ' '),
  });
  edit.appendChild(swatch(vizOf(map, t.category), 'lg'));
  const mid = el('span', { class: 'tx-mid' });
  mid.appendChild(el('span', { class: 'tx-cat' }, t.category));
  if (t.memo) mid.appendChild(el('span', { class: 'tx-memo' }, t.memo));
  edit.appendChild(mid);
  const side = el('span', { class: 'tx-side' });
  side.appendChild(el('span', { class: `tx-amount ${t.type}`, 'aria-label': `${kind} ${formatWon(t.amount)}` }, formatSignedWon(t.type, t.amount)));
  const badge = el('span', { class: `tx-kind badge badge--${t.type}` });
  badge.appendChild(el('span', { class: `icon icon--${t.type}`, 'aria-hidden': 'true' }));
  badge.appendChild(document.createTextNode(kind));
  side.appendChild(badge);
  edit.appendChild(side);
  edit.addEventListener('click', () => startEdit(t));
  const del = el('button', {
    type: 'button', class: 'btn btn-danger btn--danger btn--sm tx-del',
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
    ev.target.removeAttribute('aria-invalid');
    updateSaveLabel();
  });
  for (const b of document.querySelectorAll('.quick-amounts [data-add]')) {
    b.addEventListener('click', () => addAmount(Number(b.dataset.add)));
  }
  $('today-caption').textContent = longDayLabel(today());
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
