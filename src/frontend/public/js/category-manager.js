// 카테고리 관리 화면 (#categories). 지출/수입은 같은 컴포넌트·같은 컨트롤로 다룬다 (데이터만 다름).
// 사용자 입력(이름)은 textContent 로만 출력한다.
import { api } from './api.js';
import { el, $, swatch } from './dom.js';
import { currentFormType } from './record.js';
import { stableVizMap, vizOf } from './lib/viz.js';
import { loadCategories, categoryResponse, categoryStatus, categoryError } from './categories.js';
import {
  MAX_ACTIVE, TYPE_LABEL, splitItems, validateCategoryName, renameNote, disableConfirmText, limitText,
} from './lib/categories-data.js';

const ui = {
  type: 'expense',
  renamingId: null,
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

function activeRow(item) {
  const li = el('li', { class: 'cat-row', 'data-id': item.id });
  if (ui.renamingId === item.id) return renameRow(li, item);
  const line = el('div', { class: 'cat-line' });
  line.appendChild(swatch(vizOf(vizMap, item.name), 'lg'));
  const info = el('div', { class: 'cat-info' });
  info.appendChild(el('span', { class: 'cat-name' }, item.name));
  info.appendChild(el('span', { class: 'cat-used' }, `기록 ${item.usedCount || 0}건`));
  line.appendChild(info);
  const actions = el('div', { class: 'cat-actions' });
  actions.appendChild(actionButton('이름 바꾸기', item.name, () => startRename(item)));
  actions.appendChild(actionButton('사용 안 함', item.name, () => disable(item)));
  line.appendChild(actions);
  li.appendChild(line);
  li.appendChild(rowErrorEl(item.id));
  return li;
}

function inactiveRow(item) {
  const li = el('li', { class: 'cat-row', 'data-id': item.id });
  if (ui.renamingId === item.id) return renameRow(li, item);
  const line = el('div', { class: 'cat-line' });
  line.appendChild(swatch(vizOf(vizMap, item.name), 'lg'));
  const info = el('div', { class: 'cat-info' });
  info.appendChild(el('span', { class: 'cat-name' }, item.name));
  info.appendChild(el('span', { class: 'cat-used' }, `기록 ${item.usedCount || 0}건`));
  line.appendChild(info);
  const actions = el('div', { class: 'cat-actions' });
  actions.appendChild(actionButton('이름 바꾸기', item.name, () => startRename(item)));
  actions.appendChild(actionButton('다시 사용', item.name, () => enable(item)));
  line.appendChild(actions);
  li.appendChild(line);
  li.appendChild(rowErrorEl(item.id));
  return li;
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
  const ren = document.querySelector('.cat-rename input');
  if (ren && document.activeElement === document.body) ren.focus();
}

function rowButton(id, label) {
  const row = document.querySelector(`#panel-categories .cat-row[data-id="${CSS.escape(id)}"]`);
  return row ? [...row.querySelectorAll('button')].find((b) => b.textContent === label) : null;
}

// ---------------- 동작 ----------------
function startRename(item) {
  if (busy) return;
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
  ui.rowError = null;
  ui.restoreId = null;
  $('catm-add-error').textContent = '';
  $('catm-name').removeAttribute('aria-invalid');
  $('catm-name').value = '';
  setStatus('');
  render();
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
      ui.type = currentFormType();
      ui.renamingId = null;
      ui.rowError = null;
      ui.restoreId = null;
      setStatus('');
      $('catm-add-error').textContent = '';
      $('catm-name').value = '';
      render();
      $('cat-title').focus();
      // 거래 저장·삭제로 usedCount 가 바뀌었을 수 있으니 들어올 때마다 다시 받는다 (끝나면 'categorieschanged' 로 다시 그려진다)
      loadCategories();
    }
    wasOpen = open;
  };
  document.addEventListener('tabchange', (ev) => onTab(ev.detail.tab === 'categories'));
  onTab(!$('panel-categories').hidden);
}
