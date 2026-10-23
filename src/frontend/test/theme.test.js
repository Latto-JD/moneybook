import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { parseTheme, readTheme, saveTheme, applyTheme, initThemeToggle, nextTheme, toggleLabel, systemTheme, effectiveTheme, THEME_KEY } from '../public/js/lib/theme.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
function fakeRoot() {
  const a = {};
  return { a, setAttribute: (k, v) => { a[k] = v; }, removeAttribute: (k) => { delete a[k]; } };
}
function fakeBtn() {
  const h = {};
  const text = { textContent: '' };
  const icon = { className: '' };
  return {
    h, text, icon, dataset: {}, attrs: {},
    querySelector: (q) => (q === '.theme-toggle__text' ? text : icon),
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener: (t, f) => { h[t] = f; },
  };
}
function fakeWin() {
  const h = {};
  return { h, addEventListener: (t, f) => { h[t] = f; } };
}

test('parseTheme: light/dark 외는 auto', () => {
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  for (const v of [null, undefined, '', 'blue', 'auto', 'DARK']) assert.equal(parseTheme(v), 'auto');
});

test('readTheme: 저장소 예외는 auto', () => {
  assert.equal(readTheme(memStorage({ [THEME_KEY]: 'dark' })), 'dark');
  assert.equal(readTheme({ getItem() { throw new Error('denied'); } }), 'auto');
});

test('saveTheme: auto 는 키 삭제, 예외는 무시', () => {
  const s = memStorage();
  saveTheme(s, 'dark');
  assert.equal(s.m.get(THEME_KEY), 'dark');
  saveTheme(s, 'auto');
  assert.equal(s.m.has(THEME_KEY), false);
  assert.doesNotThrow(() => saveTheme({ setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } }, 'light'));
});

test('applyTheme: 속성 설정/제거', () => {
  const r = fakeRoot();
  applyTheme(r, 'dark');
  assert.equal(r.a['data-theme'], 'dark');
  applyTheme(r, 'auto');
  assert.equal('data-theme' in r.a, false);
});

test('nextTheme: 2상태 (다크 -> 라이트, 그 밖 -> 다크)', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('auto'), 'dark');
  assert.equal(nextTheme('blue'), 'dark');
});

test('toggleLabel: 현재 모드 글자를 포함하고 다음 모드를 알림', () => {
  assert.equal(toggleLabel('light'), '화면 모드: 라이트. 누르면 다크로 바뀌어요');
  assert.equal(toggleLabel('dark'), '화면 모드: 다크. 누르면 라이트로 바뀌어요');
});

test('systemTheme: matchMedia 결과, 없거나 예외면 light', () => {
  assert.equal(systemTheme({ matchMedia: () => ({ matches: true }) }), 'dark');
  assert.equal(systemTheme({ matchMedia: () => ({ matches: false }) }), 'light');
  assert.equal(systemTheme({}), 'light');
  assert.equal(systemTheme({ matchMedia() { throw new Error('x'); } }), 'light');
});

test('effectiveTheme: 저장값 우선, 그 밖은 OS', () => {
  assert.equal(effectiveTheme('light', 'dark'), 'light');
  assert.equal(effectiveTheme('dark', 'light'), 'dark');
  for (const v of ['auto', null, 'blue']) assert.equal(effectiveTheme(v, 'dark'), 'dark');
  assert.equal(effectiveTheme('auto', 'light'), 'light');
});

function mqlWin(dark) {
  const h = {};
  const mql = { matches: dark, addEventListener: (t, f) => { h.mql = f; } };
  return { h, mql, addEventListener: (t, f) => { h[t] = f; }, matchMedia: () => mql };
}

test('initThemeToggle: 저장값 없음 + OS 다크 -> 다크 표시, 클릭하면 light 저장', () => {
  const s = memStorage();
  const root = fakeRoot();
  const btn = fakeBtn();
  const win = mqlWin(true);
  const status = { textContent: '' };
  initThemeToggle(btn, { status, storage: s, root, win });
  assert.equal(btn.dataset.mode, 'dark');
  assert.equal(btn.text.textContent, '다크');
  assert.equal(btn.icon.className, 'icon icon--theme-dark');
  assert.equal('data-theme' in root.a, false);

  btn.h.click();
  assert.equal(s.m.get(THEME_KEY), 'light');
  assert.equal(root.a['data-theme'], 'light');
  assert.equal(btn.dataset.mode, 'light');
  assert.equal(btn.text.textContent, '라이트');
  assert.equal(status.textContent, '라이트 모드');
  assert.match(btn.attrs['aria-label'], /^화면 모드: 라이트/);

  btn.h.click();
  assert.equal(s.m.get(THEME_KEY), 'dark');
  assert.equal(status.textContent, '다크 모드');
  assert.equal(s.m.size, 1); // 키 삭제 없음
});

test('initThemeToggle: OS 변경은 저장값이 없을 때만 표시에 반영', () => {
  const s = memStorage();
  const btn = fakeBtn();
  const win = mqlWin(false);
  initThemeToggle(btn, { storage: s, root: fakeRoot(), win });
  assert.equal(btn.dataset.mode, 'light');
  win.mql.matches = true;
  win.h.mql();
  assert.equal(btn.dataset.mode, 'dark');
  btn.h.click(); // light 저장
  win.mql.matches = true;
  win.h.mql();
  assert.equal(btn.dataset.mode, 'light');
});

test('initThemeToggle: storage 이벤트 반영, 키가 지워지면 OS 모드로', () => {
  const s = memStorage();
  const root = fakeRoot();
  const btn = fakeBtn();
  const win = mqlWin(true);
  initThemeToggle(btn, { storage: s, root, win });
  s.setItem(THEME_KEY, 'light');
  win.h.storage({ key: THEME_KEY });
  assert.equal(btn.dataset.mode, 'light');
  assert.equal(root.a['data-theme'], 'light');
  s.setItem(THEME_KEY, 'dark');
  win.h.storage({ key: 'other' });
  assert.equal(btn.dataset.mode, 'light');
  s.removeItem(THEME_KEY);
  win.h.storage({ key: THEME_KEY });
  assert.equal(btn.dataset.mode, 'dark'); // OS 다크
  assert.equal('data-theme' in root.a, false);
});

test('initThemeToggle: 저장값·잘못된 값·matchMedia 없음', () => {
  let btn = fakeBtn();
  initThemeToggle(btn, { storage: memStorage({ [THEME_KEY]: 'dark' }), root: fakeRoot(), win: mqlWin(false) });
  assert.equal(btn.dataset.mode, 'dark');
  btn = fakeBtn();
  initThemeToggle(btn, { storage: memStorage({ [THEME_KEY]: 'auto' }), root: fakeRoot(), win: mqlWin(true) });
  assert.equal(btn.dataset.mode, 'dark'); // 'auto' 는 저장값 없음으로 본다
  btn = fakeBtn();
  initThemeToggle(btn, { storage: memStorage(), root: fakeRoot(), win: fakeWin() });
  assert.equal(btn.dataset.mode, 'light');
});

function runInit(storage) {
  const root = fakeRoot();
  const code = readFileSync(new URL('../public/js/theme-init.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, { window: { localStorage: storage }, document: { documentElement: root } });
  return root.a;
}

test('theme-init.js: 저장값 적용, 잘못된 값·예외는 무시', () => {
  assert.equal(runInit(memStorage({ [THEME_KEY]: 'dark' }))['data-theme'], 'dark');
  assert.equal(runInit(memStorage({ [THEME_KEY]: 'light' }))['data-theme'], 'light');
  assert.deepEqual(runInit(memStorage({ [THEME_KEY]: 'blue' })), {});
  assert.deepEqual(runInit({ getItem() { throw new Error('denied'); } }), {});
});

test('HTML: 헤더는 #theme-toggle 버튼(select 없음), 상태 영역 role=status', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button[^>]*id="theme-toggle"/);
  assert.doesNotMatch(html, /<select/i);
  assert.doesNotMatch(html.match(/<button[^>]*id="theme-toggle"[^>]*>/)[0], /aria-pressed/);
  assert.match(html, /id="theme-status" role="status"/);
  assert.match(html, /id="theme-toggle" data-mode="light"/);
  assert.doesNotMatch(html, /theme-auto/);
});

test('아이콘 2개: svg, metadata·외부 URL 없음, theme-auto.svg 없음', () => {
  assert.equal(existsSync(new URL('../public/icons/theme-auto.svg', import.meta.url)), false);
  for (const n of ['light', 'dark']) {
    const svg = readFileSync(new URL(`../public/icons/theme-${n}.svg`, import.meta.url), 'utf8');
    assert.match(svg, /^<svg /);
    assert.doesNotMatch(svg, /metadata|c2pa|data:|https?:\/\/(?!www\.w3\.org)/);
  }
});

test('HTML: theme-init.js 는 첫 stylesheet 보다 앞, classic 동기', () => {
  for (const f of ['index.html', 'login.html']) {
    const html = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    const tag = html.match(/<script[^>]*theme-init\.js[^>]*>/);
    assert.ok(tag, f);
    assert.ok(!/type=|defer|async/.test(tag[0]), f);
    assert.ok(html.indexOf(tag[0]) < html.indexOf('<link rel="stylesheet"'), f);
  }
});

test('CSS: 화면 모드 버튼은 아이콘만(글자는 시각적으로 숨김), 44px 원형, 색 있는 SVG 는 배경으로', () => {
  const css = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.theme-toggle \{[^}]*width: var\(--touch-min\)[^}]*border-radius: 50%/);
  assert.match(css, /\.theme-toggle__text \{[^}]*clip: rect/);
  for (const n of ['light', 'dark']) {
    const svg = readFileSync(new URL(`../public/icons/theme-${n}.svg`, import.meta.url), 'utf8');
    assert.match(svg, /#F6C343/);
  }
});
