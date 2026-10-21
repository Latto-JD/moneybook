// 하단 탭: 해시(#record / #dashboard)로 화면 전환. 새로고침/뒤로가기 유지.
// #categories 는 하단 탭 없이 기록/대시보드에서 링크로 들어가는 패널이다 (탭바에서는 대시보드가 활성).
// #account(내 정보)도 헤더 링크로 들어가는 패널이며 탭바에서는 기록이 활성이다.
const TABS = ['record', 'dashboard', 'categories', 'account'];
const TAB_LINK = { record: 'record', dashboard: 'dashboard', categories: 'dashboard', account: 'record' };

function currentTab() {
  const name = location.hash.replace('#', '');
  return TABS.includes(name) ? name : 'record';
}

function apply() {
  const active = currentTab();
  for (const name of TABS) {
    const panel = document.getElementById(`panel-${name}`);
    const link = document.getElementById(`tab-${name}`);
    if (panel) panel.hidden = name !== active;
    if (link) {
      if (name === TAB_LINK[active]) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  document.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: active } }));
}

window.addEventListener('hashchange', apply);
apply();
