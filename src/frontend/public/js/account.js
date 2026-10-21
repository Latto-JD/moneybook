// 내 정보 화면 (#account): 이메일 표시, 이름 설정·수정. 사용자 입력은 textContent/value 로만 다룬다.
import { api } from './api.js';
import { $ } from './dom.js';
import { validateName } from './lib/validate.js';

const NO_NAME_HINT = '이름을 넣으면 위쪽에 이메일 대신 이름이 보여요.';

export function initAccount(user, onUpdate) {
  let busy = false;
  const input = $('account-name');
  const err = $('account-name-error');

  function fill(u) {
    $('account-email').textContent = u.email;
    input.value = u.name || '';
    $('account-hint').textContent = u.name ? '' : NO_NAME_HINT;
  }
  function clearError() {
    err.textContent = '';
    input.removeAttribute('aria-invalid');
  }
  function showError(msg) {
    err.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  fill(user);

  // 화면에 들어올 때마다 저장된 값으로 되돌리고 제목으로 포커스
  document.addEventListener('tabchange', (ev) => {
    if (ev.detail.tab !== 'account') return;
    fill(user);
    clearError();
    $('account-status').textContent = '';
    $('account-title').focus();
  });

  $('account-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    clearError();
    $('account-status').textContent = '';
    const n = validateName(input.value);
    if (!n.ok) { showError(n.message); return; }
    busy = true;
    $('account-save').disabled = true;
    try {
      const res = await api.updateMe(n.value);
      user = res.user;
      fill(user);
      onUpdate(user);
      $('account-status').textContent = '저장했어요';
    } catch (e) {
      if (e.status === 401) return; // api 클라이언트가 로그인 화면으로 보낸다
      showError((e.fields && e.fields.name) || e.message);
    } finally {
      busy = false;
      $('account-save').disabled = false;
    }
  });
}
