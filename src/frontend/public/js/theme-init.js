// 깜빡임 방지: <head> 에서 CSS 보다 먼저 동기 실행(classic, defer/async/module 금지).
// 저장된 화면 모드를 <html data-theme> 에 즉시 반영한다. 규칙은 js/lib/theme.js 와 같다.
(function () {
  try {
    var v = window.localStorage.getItem('mb-theme');
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
  } catch (e) { /* 저장소 접근 불가: 자동 */ }
  // 상단 막대 색: 이 시점에는 CSS 가 없어 읽을 수 없다. 스타일시트가 모두 적용된 load 뒤에 배경색(--color-bg 계산값)을 meta 에 넣는다.
  // (로그인 화면도 쓰는 경로. 화면 모드를 바꿀 때는 lib/theme.js 가 다시 맞춘다)
  try {
    window.addEventListener('load', function () {
      try {
        var m = document.querySelector('meta[name="theme-color"]');
        var c = window.getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
        if (m && c) m.setAttribute('content', c);
      } catch (e) { /* 무시 */ }
    });
  } catch (e) { /* 무시 */ }
})();
