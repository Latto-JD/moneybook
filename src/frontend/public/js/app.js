// 앱 진입점: 세션 확인 -> 기록/대시보드 초기화, 로그아웃
import { api } from './api.js';
import { $ } from './dom.js';
import { initRecord } from './record.js';
import { initDashboard } from './dashboard.js';
import { initCategoryManager } from './category-manager.js';
import { initThemeToggle } from './lib/theme.js';
import { userLabel } from './lib/user-label.js';
import { initHistory } from './history.js';
import { initAccount } from './account.js';
import './scroll-spring.js';

initThemeToggle($('theme-toggle'), { status: $('theme-status') });

// 헤더: 이름(없으면 이메일). textContent 만 사용. title 은 로그인 ID(이메일) 확인용.
function showUser(user) {
  const l = userLabel(user);
  $('user-name-text').textContent = l.text;
  $('user-name').title = l.title;
  $('user-name').setAttribute('aria-label', l.ariaLabel);
}

async function main() {
  let currentUser;
  try {
    currentUser = (await api.me()).user;
    showUser(currentUser);
  } catch (e) {
    if (e.status === 401) { location.replace('/login.html'); return; }
    $('flash').textContent = e.message;
    return;
  }
  $('logout-btn').addEventListener('click', async () => {
    $('logout-btn').disabled = true;
    try { await api.logout(); } catch { /* 세션이 없어도 로그인 화면으로 */ }
    location.assign('/login.html');
  });
  initRecord();
  initDashboard();
  initCategoryManager();
  initHistory();
  initAccount(currentUser, showUser);
}
main();

// 로그아웃 후 뒤로가기(bfcache)로 이전 화면이 복원되면 인증을 다시 확인한다
window.addEventListener('pageshow', async (e) => {
  if (!e.persisted) return;
  try { await api.me(); } catch (err) {
    if (err.status === 401) location.replace('/login.html');
  }
});
