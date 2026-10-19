// 하단 탭: 해시(#record / #dashboard)로 화면 전환. 새로고침/뒤로가기 유지.
const TABS = ['record', 'dashboard'];

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
      if (name === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  document.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: active } }));
}

window.addEventListener('hashchange', apply);
apply();
