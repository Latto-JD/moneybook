// 로그인/가입 화면
import { api } from './api.js';
import { validateEmail, validatePassword } from './lib/validate.js';
import { authErrorMessage, EXPIRED_TEXT } from './lib/messages.js';

const $ = (id) => document.getElementById(id);
const form = $('auth-form');
const title = $('auth-title');
const submitBtn = $('submit-btn');
const formError = $('form-error');
let mode = 'login';
let busy = false;

function setMode(next) {
  mode = next;
  const signup = next === 'signup';
  $('mode-login').setAttribute('aria-pressed', String(!signup));
  $('mode-signup').setAttribute('aria-pressed', String(signup));
  title.textContent = signup ? '가계부 가입' : '가계부 로그인';
  submitBtn.textContent = signup ? '가입하기' : '로그인';
  $('password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  document.title = `${signup ? '가입' : '로그인'} - 가계부`;
  clearErrors();
}

function clearErrors() {
  $('email-error').textContent = '';
  $('password-error').textContent = '';
  formError.textContent = '';
  $('email').removeAttribute('aria-invalid');
  $('password').removeAttribute('aria-invalid');
}

function fieldError(id, message) {
  $(`${id}-error`).textContent = message;
  $(id).setAttribute('aria-invalid', 'true');
}

async function onSubmit(ev) {
  ev.preventDefault();
  if (busy) return;
  clearErrors();
  const e = validateEmail($('email').value);
  const p = validatePassword($('password').value);
  if (!e.ok) fieldError('email', e.message);
  if (!p.ok) fieldError('password', p.message);
  if (!e.ok) { $('email').focus(); return; }
  if (!p.ok) { $('password').focus(); return; }

  busy = true;
  submitBtn.disabled = true;
  try {
    if (mode === 'signup') await api.signup(e.value, p.value);
    else await api.login(e.value, p.value);
    location.assign('/');
  } catch (err) {
    if (err.fields && err.fields.email) fieldError('email', err.fields.email);
    if (err.fields && err.fields.password) fieldError('password', err.fields.password);
    formError.textContent = authErrorMessage(err);
    busy = false;
    submitBtn.disabled = false;
  }
}

$('mode-login').addEventListener('click', () => setMode('login'));
$('mode-signup').addEventListener('click', () => setMode('signup'));
$('show-password').addEventListener('change', (ev) => {
  $('password').type = ev.target.checked ? 'text' : 'password';
});
form.addEventListener('submit', onSubmit);

// 이미 로그인되어 있으면 앱으로
if (new URLSearchParams(location.search).get('expired') === '1') formError.textContent = EXPIRED_TEXT;
api.me().then(() => location.replace('/')).catch(() => { $('email').focus(); });

// bfcache 복원 시(로그인 후 뒤로가기 등) 세션이 있으면 앱으로, 아니면 비밀번호 입력값을 비운다
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  api.me().then(() => location.replace('/')).catch(() => {
    $('password').value = '';
    busy = false;
    submitBtn.disabled = false;
  });
});
