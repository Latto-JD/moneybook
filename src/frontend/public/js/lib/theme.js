// 화면 모드(자동/라이트/다크): 값 해석·저장·적용. 저장 키 mb-theme, 자동은 키 없음.
export const THEME_KEY = 'mb-theme';

// 저장값 -> 'light' | 'dark' | 'auto'. 그 외 값은 자동.
export function parseTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function readTheme(storage) {
  try { return parseTheme(storage.getItem(THEME_KEY)); } catch { return 'auto'; }
}

// 저장 실패(사생활 보호 모드 등)는 무시하고 화면에만 적용한다.
export function saveTheme(storage, mode) {
  try {
    if (mode === 'light' || mode === 'dark') storage.setItem(THEME_KEY, mode);
    else storage.removeItem(THEME_KEY);
  } catch { /* 무시 */ }
}

export function applyTheme(root, mode) {
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
}

export const MODES = ['auto', 'light', 'dark'];
export const MODE_LABEL = { auto: '자동', light: '라이트', dark: '다크' };

// 순환 순서: 자동 -> 라이트 -> 다크 -> 자동
export function nextTheme(mode) {
  return MODES[(MODES.indexOf(parseTheme(mode)) + 1) % MODES.length];
}

// 접근 이름: 보이는 글자(현재 모드)를 포함하고 다음 모드를 알려 준다.
export function toggleLabel(mode) {
  return `화면 모드: ${MODE_LABEL[mode]}. 누르면 ${MODE_LABEL[nextTheme(mode)]}(으)로 바뀌어요`;
}

// 헤더 순환 버튼 연결. 다른 탭에서 바꾼 값(storage 이벤트)도 반영한다.
// 버튼 안에는 .icon 과 .theme-toggle__text 가 있어야 한다. status 는 role="status" 영역(변경 알림).
export function initThemeToggle(button, { status = null, storage = window.localStorage, root = document.documentElement, win = window } = {}) {
  const text = button.querySelector('.theme-toggle__text');
  const icon = button.querySelector('.icon');
  let mode = readTheme(storage);

  function show() {
    button.dataset.mode = mode;
    button.setAttribute('aria-label', toggleLabel(mode));
    if (text) text.textContent = MODE_LABEL[mode];
    if (icon) icon.className = `icon icon--theme-${mode}`;
  }
  show();

  button.addEventListener('click', () => {
    mode = nextTheme(mode);
    saveTheme(storage, mode);
    applyTheme(root, mode);
    show();
    if (status) status.textContent = `${MODE_LABEL[mode]} 모드`;
  });
  win.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== THEME_KEY) return;
    mode = readTheme(storage);
    applyTheme(root, mode);
    show();
  });
}
