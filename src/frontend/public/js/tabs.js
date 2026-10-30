// 하단 탭: 해시(#record / #dashboard)로 화면 전환. 새로고침/뒤로가기 유지.
// #categories 는 하단 탭 없이 기록/대시보드에서 링크로 들어가는 패널이다 (탭바에서는 대시보드가 활성).
// #account(내 정보)도 헤더 링크로 들어가는 패널이며 탭바에서는 기록이 활성이다.
// #history(카테고리 사용 이력)도 기록 탭에서 들어가는 패널이며 탭바에서는 기록이 활성이다.
const TABS = ['record', 'dashboard', 'categories', 'account', 'history'];
const TAB_LINK = { record: 'record', dashboard: 'dashboard', categories: 'dashboard', account: 'record', history: 'record' };

function currentTab() {
  const name = location.hash.replace('#', '');
  return TABS.includes(name) ? name : 'record';
}

// 첫 화면 로드는 움직이지 않는다. 그 뒤 탭 전환으로 새로 보이게 되는 패널에만 panel--enter 를 붙인다(CSS 페이드 150ms).
// 이미 보이는 패널에 클래스를 나중에 붙이면 그 순간 애니메이션이 시작되므로, 숨겨져 있던 패널을 보이게 하는 같은 순간에만 붙인다.
let ready = false;

function apply() {
  const active = currentTab();
  for (const name of TABS) {
    const panel = document.getElementById(`panel-${name}`);
    const link = document.getElementById(`tab-${name}`);
    if (panel) {
      const show = name === active;
      if (ready && show && panel.hidden) panel.classList.add('panel--enter');
      panel.hidden = !show;
    }
    if (link) {
      if (name === TAB_LINK[active]) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  document.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: active } }));
}

window.addEventListener('hashchange', apply);
apply();
ready = true;
requestAnimationFrame(() => { document.documentElement.setAttribute('data-motion-ready', ''); });
