import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseTheme, readTheme, saveTheme, applyTheme, initThemeToggle, nextTheme, toggleLabel, THEME_KEY } from '../public/js/lib/theme.js';

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

test('nextTheme: 자동 -> 라이트 -> 다크 -> 자동', () => {
  assert.equal(nextTheme('auto'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'auto');
  assert.equal(nextTheme('blue'), 'light');
});

test('toggleLabel: 현재 모드 글자를 포함하고 다음 모드를 알림', () => {
  assert.equal(toggleLabel('light'), '화면 모드: 라이트. 누르면 다크(으)로 바뀌어요');
  assert.match(toggleLabel('auto'), /^화면 모드: 자동/);
});

test('initThemeToggle: 클릭마다 순환·저장·적용·알림, storage 이벤트 반영', () => {
  const s = memStorage();
  const root = fakeRoot();
  const btn = fakeBtn();
  const win = fakeWin();
  const status = { textContent: '' };
  initThemeToggle(btn, { status, storage: s, root, win });
  assert.equal(btn.dataset.mode, 'auto');
  assert.equal(btn.text.textContent, '자동');
  assert.equal(btn.icon.className, 'icon icon--theme-auto');

  btn.h.click();
  assert.equal(btn.dataset.mode, 'light');
  assert.equal(s.m.get(THEME_KEY), 'light');
  assert.equal(root.a['data-theme'], 'light');
  assert.equal(btn.text.textContent, '라이트');
  assert.equal(btn.icon.className, 'icon icon--theme-light');
  assert.equal(status.textContent, '라이트 모드');
  assert.match(btn.attrs['aria-label'], /라이트/);

  btn.h.click();
  assert.equal(s.m.get(THEME_KEY), 'dark');
  assert.equal(root.a['data-theme'], 'dark');
  btn.h.click();
  assert.equal(s.m.has(THEME_KEY), false);
  assert.equal('data-theme' in root.a, false);
  assert.equal(btn.dataset.mode, 'auto');

  s.setItem(THEME_KEY, 'dark');
  win.h.storage({ key: THEME_KEY });
  assert.equal(btn.dataset.mode, 'dark');
  assert.equal(btn.text.textContent, '다크');
  assert.equal(root.a['data-theme'], 'dark');
  s.setItem(THEME_KEY, 'light');
  win.h.storage({ key: 'other' });
  assert.equal(btn.dataset.mode, 'dark');
});

test('initThemeToggle: 저장값으로 시작', () => {
  const btn = fakeBtn();
  initThemeToggle(btn, { storage: memStorage({ [THEME_KEY]: 'dark' }), root: fakeRoot(), win: fakeWin() });
  assert.equal(btn.dataset.mode, 'dark');
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
});

test('아이콘 3개: svg, metadata·외부 URL 없음', () => {
  for (const n of ['auto', 'light', 'dark']) {
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
