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

// 헤더 select 연결. 다른 탭에서 바꾼 값(storage 이벤트)도 반영한다.
export function initThemeSelect(select, { storage = window.localStorage, root = document.documentElement, win = window } = {}) {
  select.value = readTheme(storage);
  select.addEventListener('change', () => {
    const mode = parseTheme(select.value);
    saveTheme(storage, mode);
    applyTheme(root, mode);
  });
  win.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== THEME_KEY) return;
    const mode = readTheme(storage);
    applyTheme(root, mode);
    select.value = mode;
  });
}
