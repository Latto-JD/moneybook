// 깜빡임 방지: <head> 에서 CSS 보다 먼저 동기 실행(classic, defer/async/module 금지).
// 저장된 화면 모드를 <html data-theme> 에 즉시 반영한다. 규칙은 js/lib/theme.js 와 같다.
(function () {
  try {
    var v = window.localStorage.getItem('mb-theme');
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
  } catch (e) { /* 저장소 접근 불가: 자동 */ }
})();
