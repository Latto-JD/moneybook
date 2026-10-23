// 화면 모드(라이트/다크): 값 해석·저장·적용. 저장 키 mb-theme, 'auto'(저장값 없음)는 OS 설정을 따른다.
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

export const MODES = ['light', 'dark'];
export const MODE_LABEL = { light: '라이트', dark: '다크' };

// 눈에 보이는 모드가 다크면 라이트로, 그 밖에는 다크로 (자동 단계 없음)
export function nextTheme(mode) {
  return mode === 'dark' ? 'light' : 'dark';
}

// OS 설정이 다크면 'dark'. matchMedia 가 없거나 예외면 'light'.
export function systemTheme(win) {
  try { return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}

// 저장값이 light/dark 면 그것, 아니면(없음·'auto'·잘못된 값) OS 모드
export function effectiveTheme(stored, system) {
  return stored === 'light' || stored === 'dark' ? stored : system;
}

// 접근 이름: 보이는 글자(현재 모드)를 포함하고 다음 모드를 알려 준다.
export function toggleLabel(mode) {
  return `화면 모드: ${MODE_LABEL[mode]}. 누르면 ${MODE_LABEL[nextTheme(mode)]}로 바뀌어요`;
}

// 헤더 2상태 버튼 연결. 저장값이 없으면 OS 모드를 보여 주고, 누르면 반대 모드를 저장한다.
// 다른 탭에서 바꾼 값(storage 이벤트)도 반영한다.
// 버튼 안에는 .icon 과 .theme-toggle__text 가 있어야 한다. status 는 role="status" 영역(변경 알림).
export function initThemeToggle(button, { status = null, storage = window.localStorage, root = document.documentElement, win = window } = {}) {
  const text = button.querySelector('.theme-toggle__text');
  const icon = button.querySelector('.icon');
  let stored = readTheme(storage);
  let mql = null;
  try { mql = win.matchMedia('(prefers-color-scheme: dark)'); } catch { /* 무시 */ }
  const current = () => effectiveTheme(stored, systemTheme(win));

  function show() {
    const mode = current();
    button.dataset.mode = mode;
    button.setAttribute('aria-label', toggleLabel(mode));
    if (text) text.textContent = MODE_LABEL[mode];
    if (icon) icon.className = `icon icon--theme-${mode}`;
  }
  show();

  button.addEventListener('click', () => {
    const mode = nextTheme(current());
    stored = mode;
    saveTheme(storage, mode);
    applyTheme(root, mode);
    show();
    if (status) status.textContent = `${MODE_LABEL[mode]} 모드`;
  });
  win.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== THEME_KEY) return;
    stored = readTheme(storage);
    applyTheme(root, stored);
    show();
  });
  // 저장값이 없을 때만 OS 변경을 따라 표시를 갱신한다 (색은 CSS 가 이미 바꾼다)
  if (mql && typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', () => { if (stored === 'auto') show(); });
  }
}
