import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseTheme, readTheme, saveTheme, applyTheme, initThemeSelect, THEME_KEY } from '../public/js/lib/theme.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
function fakeRoot() {
  const a = {};
  return { a, setAttribute: (k, v) => { a[k] = v; }, removeAttribute: (k) => { delete a[k]; } };
}
function fakeEl() {
  const h = {};
  return { value: '', addEventListener: (t, f) => { h[t] = f; }, h };
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

test('initThemeSelect: 변경 시 저장·적용, storage 이벤트 반영', () => {
  const s = memStorage({ [THEME_KEY]: 'light' });
  const root = fakeRoot();
  const sel = fakeEl();
  const win = fakeEl();
  initThemeSelect(sel, { storage: s, root, win });
  assert.equal(sel.value, 'light');
  sel.value = 'dark';
  sel.h.change();
  assert.equal(s.m.get(THEME_KEY), 'dark');
  assert.equal(root.a['data-theme'], 'dark');
  sel.value = 'auto';
  sel.h.change();
  assert.equal(s.m.has(THEME_KEY), false);
  assert.equal('data-theme' in root.a, false);
  s.setItem(THEME_KEY, 'light');
  win.h.storage({ key: THEME_KEY });
  assert.equal(sel.value, 'light');
  assert.equal(root.a['data-theme'], 'light');
  s.setItem(THEME_KEY, 'dark');
  win.h.storage({ key: 'other' });
  assert.equal(sel.value, 'light');
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

test('HTML: theme-init.js 는 첫 stylesheet 보다 앞, classic 동기', () => {
  for (const f of ['index.html', 'login.html']) {
    const html = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    const tag = html.match(/<script[^>]*theme-init\.js[^>]*>/);
    assert.ok(tag, f);
    assert.ok(!/type=|defer|async/.test(tag[0]), f);
    assert.ok(html.indexOf(tag[0]) < html.indexOf('<link rel="stylesheet"'), f);
  }
});
