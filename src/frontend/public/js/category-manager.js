// 카테고리 관리 화면 (#categories). 지출/수입은 같은 컴포넌트·같은 컨트롤로 다룬다 (데이터만 다름).
// 사용자 입력(이름)은 textContent 로만 출력한다.
import { api } from './api.js';
import { el, $, swatch } from './dom.js';
import { currentFormType } from './record.js';
import { openHistory, returnTarget, takeHistoryFocus } from './history.js';
import { stableVizMap, vizOf, vizName, VIZ_COUNT } from './lib/viz.js';
import { loadCategories, categoryResponse, categoryStatus, categoryError } from './categories.js';
import { budgetInputDisplay, parseBudgetInput, budgetDraft, categoryMeta, budgetButtonLabel, budgetSavedText } from './lib/budget-data.js';
import {
  MAX_ACTIVE, TYPE_LABEL, splitItems, validateCategoryName, renameNote, disableConfirmText, limitText,
} from './lib/categories-data.js';

const ui = {
  type: 'expense',
  renamingId: null,
  colorId: null, // 색 고르기 영역이 열린 카테고리 id (한 번에 한 행)
  budgetId: null, // 예산 입력 행이 열린 카테고리 id (색·이름·예산 중 한 번에 한 행)
  budgetDraft: '', // 예산 입력칸 값 (오류로 다시 그려도 유지)
  draft: '', // 이름 바꾸는 입력칸 값 (오류로 다시 그려도 유지)
  rowError: null, // { id, text }
  restoreId: null, // CATEGORY_INACTIVE 로 알게 된 복구 대상
};
let busy = false; // 변경 요청 진행 중: 모든 경로(클릭/Enter)에서 한 번에 하나만

const errText = (e) => (e && e.message) || '요청을 처리하지 못했어요.';

function setStatus(text) {
  $('catm-status').textContent = text;
}

/** 변경 후 서버 목록을 다시 받고 다른 화면(칩, 거래, 대시보드)에 알린다 */
async function refresh(detail) {
  await loadCategories(detail);
  render();
}

// ---------------- 렌더 ----------------
function actionButton(label, name, onClick, extraClass = '') {
  const b = el('button', { type: 'button', class: `btn btn--ghost btn--sm ${extraClass}`.trim(), 'aria-label': `${name} ${label}` }, label);
  b.addEventListener('click', onClick);
  return b;
}

function rowErrorEl(id) {
  const p = el('p', { class: 'error-text', role: 'alert' });
  if (ui.rowError && ui.rowError.id === id) p.textContent = ui.rowError.text;
  return p;
}

let vizMap = new Map(); // 렌더마다 유형별 목록 순서(비활성 포함)로 다시 만든다

/** 이름 + "기록 N건". 기록이 있으면 버튼 하나가 되어 그 카테고리의 사용 이력을 연다 */
function infoBlock(item) {
  const n = item.usedCount || 0;
  const parts = [el('span', { class: 'cat-name' }, item.name), el('span', { class: 'cat-used' }, categoryMeta(item))];
  if (n === 0) {
    const info = el('div', { class: 'cat-info' });
    info.append(...parts);
    return info;
  }
  const btn = el('button', {
    type: 'button', class: 'cat-info cat-hist-btn', 'data-hist-type': item.type, 'data-hist-cat': item.name,
    'aria-label': `${item.name} 사용 이력 보기, 기록 ${n}건`,
  });
  btn.append(...parts);
  btn.addEventListener('click', () => openHistory(item.type, item.name, 'categories'));
  return btn;
}

function activeRow(item) {
  const li = el('li', { class: 'cat-row', 'data-id': item.id });
  if (ui.renamingId === item.id) return renameRow(li, item);
  const line = el('div', { class: 'cat-line' });
  line.appendChild(swatch(vizOf(vizMap, item.name), 'lg'));
  line.appendChild(infoBlock(item));
  const actions = el('div', { class: 'cat-actions' });
  actions.appendChild(colorButton(item));
  if (item.type === 'expense') actions.appendChild(budgetButton(item));
  actions.appendChild(actionButton('이름 바꾸기', item.name, () => startRename(item)));
  actions.appendChild(actionButton('사용 안 함', item.name, () => disable(item)));
  line.appendChild(actions);
  li.appendChild(line);
  if (ui.colorId === item.id) li.appendChild(colorPicker(item));
  if (ui.budgetId === item.id && item.type === 'expense') return budgetRow(li, item);
  li.appendChild(rowErrorEl(item.id));
  return li;
}

function inactiveRow(item) {
  const li = el('li', { class: 'cat-row', 'data-id': item.id });
  if (ui.renamingId === item.id) return renameRow(li, item);
  const line = el('div', { class: 'cat-line' });
  line.appendChild(swatch(vizOf(vizMap, item.name), 'lg'));
  line.appendChild(infoBlock(item));
  const actions = el('div', { class: 'cat-actions' });
  actions.appendChild(colorButton(item));
  actions.appendChild(actionButton('이름 바꾸기', item.name, () => startRename(item)));
  actions.appendChild(actionButton('다시 사용', item.name, () => enable(item)));
  line.appendChild(actions);
  li.appendChild(line);
  if (ui.colorId === item.id) li.appendChild(colorPicker(item));
  li.appendChild(rowErrorEl(item.id));
  return li;
}

/** "예산" 버튼 (지출 활성 행만). 열려 있으면 aria-expanded */
function budgetButton(item) {
  const b = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm', 'data-budget-btn': item.id, 'aria-expanded': String(ui.budgetId === item.id),
    'aria-label': budgetButtonLabel(item),
  }, '예산');
  b.addEventListener('click', () => toggleBudget(item));
  return b;
}

/** 예산 인라인 입력 행 (라인 아래에 붙는다). 빈 칸으로 저장하면 예산을 지운다 */
function budgetRow(li, item) {
  const inputId = `catm-budget-${item.id}`;
  const noteId = `${inputId}-note`;
  li.appendChild(el('label', { for: inputId, class: 'visually-hidden' }, `${item.name} 월 예산(원)`));
  const input = el('input', {
    type: 'text', id: inputId, class: 'input', inputmode: 'numeric', enterkeyhint: 'done', autocomplete: 'off',
    'aria-describedby': `${noteId} ${inputId}-error`,
  });
  input.value = ui.budgetDraft;
  input.addEventListener('input', () => {
    input.value = budgetInputDisplay(input.value);
    ui.budgetDraft = input.value;
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if (ev.key === 'Enter') { ev.preventDefault(); saveBudget(item, input); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeBudget(item); }
  });
  const row = el('div', { class: 'cat-rename cat-budget' });
  row.appendChild(input);
  row.appendChild(el('span', { class: 'cat-budget__unit', 'aria-hidden': 'true' }, '원'));
  const save = el('button', { type: 'button', class: 'btn btn-primary btn--primary btn--sm', 'aria-label': `${item.name} 예산 저장` }, '저장');
  save.addEventListener('click', () => saveBudget(item, input));
  const cancel = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `${item.name} 예산 정하기 취소` }, '취소');
  cancel.addEventListener('click', () => closeBudget(item));
  row.appendChild(save);
  row.appendChild(cancel);
  li.appendChild(row);
  li.appendChild(el('p', { class: 'hint', id: noteId }, '비워 두고 저장하면 예산을 지워요'));
  const err = rowErrorEl(item.id);
  err.id = `${inputId}-error`;
  li.appendChild(err);
  if (ui.rowError && ui.rowError.id === item.id) input.setAttribute('aria-invalid', 'true');
  return li;
}

/** "색" 버튼: 접근 이름에 지금 색 이름을 싣는다. 열려 있으면 aria-expanded */
function colorButton(item) {
  const b = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm', 'data-color-btn': item.id, 'aria-expanded': String(ui.colorId === item.id),
    'aria-label': `${item.name} 색 바꾸기, 지금 ${vizName(vizOf(vizMap, item.name))}`,
  }, '색');
  b.addEventListener('click', () => toggleColor(item));
  return b;
}

/** 같은 유형에서 n번 색을 쓰는 다른 카테고리 이름 (비활성 포함) */
function usedBy(item, n, items) {
  const names = items.filter((i) => i.type === item.type && i.name !== item.name && vizMap.get(i.name) === n).map((i) => i.name);
  if (names.length === 0) return '';
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}곳`;
}

/** 12칸 색 고르기 (radiogroup). 화살표로 이동, Enter/Space 로 고르기, Esc 로 닫기 */
function colorPicker(item) {
  const cur = vizOf(vizMap, item.name);
  const items = (categoryResponse() && categoryResponse().items) || [];
  const group = el('div', { class: 'color-picker', role: 'radiogroup', 'aria-label': `${item.name} 색` });
  const cells = [];
  for (let n = 1; n <= VIZ_COUNT; n++) {
    const other = usedBy(item, n, items);
    const checked = n === cur;
    const b = el('button', {
      type: 'button', class: 'color-cell', role: 'radio', 'data-n': String(n), 'aria-checked': String(checked),
      tabindex: checked || (cur === 'none' && n === 1) ? '0' : '-1',
      'aria-label': other ? `${vizName(n)}, ${other}에서 사용 중` : vizName(n),
    });
    b.appendChild(el('span', { class: 'swatch swatch--cell', 'data-viz': String(n), 'aria-hidden': 'true' }));
    const badge = el('span', { class: 'color-cell__check', 'aria-hidden': 'true' });
    badge.appendChild(el('span', { class: 'icon icon--check' }));
    b.appendChild(badge);
    b.addEventListener('click', () => pickColor(item, n));
    b.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); closeColor(item); return; }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const next = cells[(n - 1 + step + VIZ_COUNT) % VIZ_COUNT];
      cells.forEach((c) => c.setAttribute('tabindex', c === next ? '0' : '-1'));
      next.focus();
    });
    cells.push(b);
    const cell = el('div', { class: 'color-slot' });
    cell.appendChild(b);
    cell.appendChild(el('span', { class: other ? 'color-used' : 'color-used color-used--none', 'aria-hidden': 'true' }));
    group.appendChild(cell);
  }
  return group;
}

function renameRow(li, item) {
  const inputId = `catm-rename-${item.id}`;
  const noteId = `${inputId}-note`;
  const label = el('label', { for: inputId, class: 'visually-hidden' }, `${item.name} 새 이름`);
  const input = el('input', {
    type: 'text', id: inputId, class: 'input', autocomplete: 'off', 'aria-describedby': `${noteId} ${inputId}-error`,
  });
  input.value = ui.draft;
  input.addEventListener('input', () => { ui.draft = input.value; });
  input.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if (ev.key === 'Enter') { ev.preventDefault(); saveRename(item, input); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelRename(item.id); }
  });
  const row = el('div', { class: 'cat-rename' });
  row.appendChild(label);
  row.appendChild(input);
  const save = el('button', { type: 'button', class: 'btn btn-primary btn--primary btn--sm', 'aria-label': `${item.name} 이름 저장` }, '저장');
  save.addEventListener('click', () => saveRename(item, input));
  const cancel = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `${item.name} 이름 바꾸기 취소` }, '취소');
  cancel.addEventListener('click', () => cancelRename(item.id));
  row.appendChild(save);
  row.appendChild(cancel);
  li.appendChild(row);
  li.appendChild(el('p', { class: 'hint', id: noteId }, renameNote(item.usedCount || 0)));
  const err = rowErrorEl(item.id);
  err.id = `${inputId}-error`;
  li.appendChild(err);
  if (ui.rowError && ui.rowError.id === item.id) input.setAttribute('aria-invalid', 'true');
  return li;
}

/** 세그먼트 버튼에 활성 개수를 붙인다 (버튼 이름은 "지출 8" 처럼 읽힌다) */
function setCount(id, label, n) {
  const b = $(id);
  b.replaceChildren(document.createTextNode(label), el('span', { class: 'seg-count' }, String(n)));
}

function render() {
  const resp = categoryResponse();
  const loadErr = $('catm-load-error');
  $('catm-expense').setAttribute('aria-pressed', String(ui.type === 'expense'));
  $('catm-income').setAttribute('aria-pressed', String(ui.type === 'income'));
  const typeLabel = TYPE_LABEL[ui.type];
  $('catm-add').hidden = !resp;
  $('catm-inactive-details').hidden = !resp;
  loadErr.hidden = !(categoryStatus() === 'error');
  $('catm-load-error-text').textContent = categoryError();
  if (!resp) {
    $('catm-list-title').textContent = categoryStatus() === 'error' ? '카테고리를 불러오지 못했어요' : '카테고리를 불러오는 중이에요';
    $('catm-active').replaceChildren();
    return;
  }
  const { active, inactive } = splitItems(resp, ui.type);
  vizMap = stableVizMap(resp.items, ui.type);
  setCount('catm-expense', '지출', splitItems(resp, 'expense').active.length);
  setCount('catm-income', '수입', splitItems(resp, 'income').active.length);
  $('catm-limit').textContent = limitText(active.length);
  $('catm-add-btn').setAttribute('aria-disabled', String(active.length >= MAX_ACTIVE));
  $('catm-list-title').textContent = `사용 중인 ${typeLabel} 카테고리 ${active.length}/${MAX_ACTIVE}`;
  $('catm-active').replaceChildren(...active.map(activeRow));
  $('catm-inactive-title').textContent = `사용 안 함 (${inactive.length})`;
  $('catm-inactive').replaceChildren(...(inactive.length
    ? inactive.map(inactiveRow)
    : [el('li', { class: 'hint empty-line' }, `사용 안 함인 ${typeLabel} 카테고리가 없어요`)]));
  $('catm-name-label').textContent = `새 ${typeLabel} 카테고리 이름`;
  $('catm-restore').hidden = !ui.restoreId;
  const ren = document.querySelector('.cat-rename:not(.cat-budget) input');
  const bud = document.querySelector('.cat-budget input');
  if (bud && document.activeElement === document.body) bud.focus();
  if (ren && document.activeElement === document.body) ren.focus();
}

function rowButton(id, label) {
  const row = document.querySelector(`#panel-categories .cat-row[data-id="${CSS.escape(id)}"]`);
  return row ? [...row.querySelectorAll('button')].find((b) => b.textContent === label) : null;
}

// ---------------- 동작 ----------------
function toggleColor(item) {
  if (busy) return;
  const open = ui.colorId !== item.id;
  ui.colorId = open ? item.id : null;
  ui.budgetId = null;
  ui.renamingId = null;
  ui.rowError = null;
  render();
  if (open) document.querySelector(`#panel-categories .cat-row[data-id="${CSS.escape(item.id)}"] .color-cell[tabindex="0"]`)?.focus();
  else rowButton(item.id, '색')?.focus();
}

function closeColor(item) {
  ui.colorId = null;
  ui.rowError = null;
  render();
  rowButton(item.id, '색')?.focus();
}

async function pickColor(item, n) {
  if (busy) return;
  const cur = vizOf(vizMap, item.name);
  if (n === cur && item.color === n) { closeColor(item); return; }
  busy = true;
  ui.rowError = null;
  const group = document.querySelector(`#panel-categories .cat-row[data-id="${CSS.escape(item.id)}"] .color-picker`);
  group?.querySelectorAll('.color-cell').forEach((c) => c.setAttribute('aria-disabled', 'true'));
  try {
    await api.updateCategory(item.id, { color: n });
    ui.colorId = null;
    await refresh({ dataChanged: true });
    setStatus(`'${item.name}' 색을 ${vizName(n)}(으)로 바꿨어요`);
    rowButton(item.id, '색')?.focus();
  } catch (e) {
    ui.rowError = { id: item.id, text: errText(e) };
    render(); // 선택 표시는 서버 값 그대로: 저장 전 색으로 돌아간다
    document.querySelector(`#panel-categories .cat-row[data-id="${CSS.escape(item.id)}"] .color-cell[data-n="${n}"]`)?.focus();
  } finally {
    busy = false;
  }
}

function toggleBudget(item) {
  if (busy) return;
  if (ui.budgetId === item.id) { closeBudget(item); return; }
  ui.budgetId = item.id;
  ui.colorId = null;
  ui.renamingId = null;
  ui.budgetDraft = budgetDraft(item.budget);
  ui.rowError = null;
  render();
  const input = $(`catm-budget-${item.id}`);
  if (input) { input.focus(); input.select(); }
}

function closeBudget(item) {
  ui.budgetId = null;
  ui.rowError = null;
  render();
  rowButton(item.id, '예산')?.focus();
}

async function saveBudget(item, input) {
  if (busy) return;
  const v = parseBudgetInput(input.value);
  if (!v.ok) { ui.rowError = { id: item.id, text: v.message }; render(); $(`catm-budget-${item.id}`)?.focus(); return; }
  busy = true;
  ui.rowError = null;
  try {
    await api.updateCategory(item.id, { budget: v.value });
    ui.budgetId = null;
    await refresh({ dataChanged: true });
    setStatus(budgetSavedText(item.name, v.value));
    rowButton(item.id, '예산')?.focus();
  } catch (e) {
    ui.rowError = { id: item.id, text: errText(e) };
    render();
    $(`catm-budget-${item.id}`)?.focus();
  } finally {
    busy = false;
  }
}

function startRename(item) {
  if (busy) return;
  ui.colorId = null;
  ui.budgetId = null;
  ui.renamingId = item.id;
  ui.draft = item.name;
  ui.rowError = null;
  render();
  const input = $(`catm-rename-${item.id}`);
  if (input) { input.focus(); input.select(); }
}

function cancelRename(id) {
  ui.renamingId = null;
  ui.rowError = null;
  render();
  rowButton(id, '이름 바꾸기')?.focus();
}

async function saveRename(item, input) {
  if (busy) return;
  const v = validateCategoryName(input.value, item.name);
  if (!v.ok) { ui.rowError = { id: item.id, text: v.message }; render(); $(`catm-rename-${item.id}`)?.focus(); return; }
  if (v.value === item.name) { cancelRename(item.id); return; }
  busy = true;
  ui.rowError = null;
  try {
    const saved = await api.updateCategory(item.id, { name: v.value });
    ui.renamingId = null;
    await refresh({ renamed: { type: item.type, from: item.name, to: saved.name }, dataChanged: true });
    setStatus(`이름을 바꿨어요: ${item.name} → ${saved.name}`);
    rowButton(item.id, '이름 바꾸기')?.focus();
  } catch (e) {
    ui.rowError = { id: item.id, text: errText(e) };
    render();
    $(`catm-rename-${item.id}`)?.focus();
  } finally {
    busy = false;
  }
}

async function disable(item) {
  if (busy) return;
  busy = true;
  try {
    if (!window.confirm(disableConfirmText(item.name, item.usedCount || 0))) return;
    ui.rowError = null;
    const before = splitItems(categoryResponse(), item.type).active;
    const at = before.findIndex((i) => i.id === item.id);
    await api.updateCategory(item.id, { active: false });
    await refresh({ dataChanged: true });
    setStatus(`'${item.name}' 카테고리를 사용 안 함으로 바꿨어요`);
    // 사라진 행 대신 같은 자리의 다음 행, 없으면 목록 제목으로
    const rows = [...document.querySelectorAll('#catm-active .cat-row')];
    const next = rows[Math.min(Math.max(at, 0), rows.length - 1)];
    (next?.querySelector('button') || $('catm-list-title')).focus();
  } catch (e) {
    ui.rowError = { id: item.id, text: errText(e) };
    render();
    rowButton(item.id, '사용 안 함')?.focus();
  } finally {
    busy = false;
  }
}

async function enable(item) {
  if (busy) return;
  busy = true;
  ui.rowError = null;
  try {
    await api.updateCategory(item.id, { active: true });
    if (ui.restoreId === item.id) ui.restoreId = null;
    await refresh({ dataChanged: true });
    setStatus(`'${item.name}' 카테고리를 다시 사용해요`);
    ($(`catm-active`).querySelector(`.cat-row[data-id="${CSS.escape(item.id)}"] button`) || $('catm-list-title')).focus();
  } catch (e) {
    ui.rowError = { id: item.id, text: errText(e) };
    render();
    rowButton(item.id, '다시 사용')?.focus();
  } finally {
    busy = false;
  }
}

async function onAdd(ev) {
  ev.preventDefault();
  if (busy) return;
  const input = $('catm-name');
  const err = $('catm-add-error');
  err.textContent = '';
  input.removeAttribute('aria-invalid');
  ui.restoreId = null;
  $('catm-restore').hidden = true;
  const v = validateCategoryName(input.value);
  if (!v.ok) { err.textContent = v.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  busy = true;
  $('catm-add-btn').disabled = true;
  try {
    const created = await api.createCategory(ui.type, v.value);
    input.value = '';
    await refresh({ dataChanged: false });
    setStatus(`'${created.name}' 카테고리를 추가했어요`);
  } catch (e) {
    err.textContent = e.code === 'CATEGORY_INACTIVE' ? '같은 이름의 사용 안 함 카테고리가 있어요.' : errText(e);
    input.setAttribute('aria-invalid', 'true');
    if (e.code === 'CATEGORY_INACTIVE' && e.categoryId) {
      ui.restoreId = e.categoryId;
      $('catm-restore').hidden = false;
    }
  } finally {
    busy = false;
    $('catm-add-btn').disabled = false;
    input.focus(); // 연속 추가
  }
}

async function onRestore() {
  if (busy || !ui.restoreId) return;
  const id = ui.restoreId;
  busy = true;
  $('catm-restore-btn').disabled = true;
  try {
    const saved = await api.updateCategory(id, { active: true });
    ui.restoreId = null;
    $('catm-add-error').textContent = '';
    $('catm-name').value = '';
    $('catm-name').removeAttribute('aria-invalid');
    await refresh({ dataChanged: true });
    setStatus(`'${saved.name}' 카테고리를 다시 사용해요`);
    $('catm-name').focus();
  } catch (e) {
    $('catm-add-error').textContent = errText(e);
  } finally {
    busy = false;
    $('catm-restore-btn').disabled = false;
  }
}

function setType(type) {
  if (ui.type === type) return;
  ui.type = type;
  ui.renamingId = null;
  ui.colorId = null;
  ui.budgetId = null;
  ui.rowError = null;
  ui.restoreId = null;
  $('catm-add-error').textContent = '';
  $('catm-name').removeAttribute('aria-invalid');
  $('catm-name').value = '';
  setStatus('');
  render();
}

/** 이력에서 돌아왔으면 다시 그린 행의 같은 버튼으로 포커스를 돌려준다 (없으면 제목에 그대로) */
function restoreHistoryFocus() {
  if ($('panel-categories').hidden) return;
  const f = takeHistoryFocus('categories');
  if (f) (f.find('#panel-categories') || $('cat-title')).focus();
}

export function initCategoryManager() {
  $('catm-expense').addEventListener('click', () => setType('expense'));
  $('catm-income').addEventListener('click', () => setType('income'));
  $('catm-add').addEventListener('submit', onAdd);
  $('catm-restore-btn').addEventListener('click', onRestore);
  $('catm-retry').addEventListener('click', async () => { await loadCategories(); render(); });
  // 다른 화면에서 목록이 바뀌어도 (예: 로드 완료) 열려 있는 동안은 따라간다
  document.addEventListener('categorieschanged', () => { if (!$('panel-categories').hidden && !busy) render(); });
  // ← : 앱 안에서 들어왔으면 온 화면으로, 주소로 바로 들어왔으면 대시보드로
  let cameFrom = null;
  $('catm-back').addEventListener('click', (ev) => {
    ev.preventDefault();
    location.hash = cameFrom || 'dashboard';
  });
  window.addEventListener('hashchange', (ev) => {
    const old = new URL(ev.oldURL).hash.replace('#', '') || 'record'; // 해시가 없던 첫 화면은 기록
    if (old === 'record' || old === 'dashboard') cameFrom = old;
  });
  let wasOpen = false;
  const onTab = (open) => {
    if (open && !wasOpen) {
      const back = returnTarget('categories'); // 이력에서 돌아오면 보던 유형 그대로
      ui.type = back ? back.type : currentFormType();
      ui.renamingId = null;
      ui.colorId = null;
      ui.budgetId = null;
      ui.rowError = null;
      ui.restoreId = null;
      setStatus('');
      $('catm-add-error').textContent = '';
      $('catm-name').value = '';
      render();
      $('cat-title').focus();
      // 거래 저장·삭제로 usedCount 가 바뀌었을 수 있으니 들어올 때마다 다시 받는다 (끝나면 'categorieschanged' 로 다시 그려진다)
      // 이력에서 돌아왔으면 이 다시 그리기가 끝난 뒤(버튼이 새로 만들어진 다음)에 포커스를 돌려준다
      loadCategories().then(restoreHistoryFocus, restoreHistoryFocus);
    }
    wasOpen = open;
  };
  document.addEventListener('tabchange', (ev) => onTab(ev.detail.tab === 'categories'));
  onTab(!$('panel-categories').hidden);
}
