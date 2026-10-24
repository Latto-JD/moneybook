import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { motionFor, motionTokens, applyMotion } from '../public/js/lib/motion.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const F = { fade: true, stagger: false };
const FS = { fade: true, stagger: true };
const N = { fade: false, stagger: false };

test('motionFor: 계획서 5.3 표 그대로', () => {
  const cards = ['kpi', 'donut', 'monthly', 'trend', 'insights'];
  const expected = {
    month: [F, FS, F, F, F],
    tab: [F, FS, F, F, F],
    range: [N, N, F, F, N], // 6/12개월: 월별·추이만(요약 카드는 같은 값)
    catview: [N, FS, N, F, N], // 지출/수입: 도넛(막대 스태거)·추이만
    catchange: [N, N, N, N, N],
    chip: [N, N, N, N, N],
  };
  for (const [reason, row] of Object.entries(expected)) {
    cards.forEach((card, i) => assert.deepEqual(motionFor(reason, card), row[i], `${reason}/${card}`));
  }
});

test('motionFor: 모르는 이유·카드는 움직이지 않는다, 반환값을 고쳐도 표는 그대로', () => {
  assert.deepEqual(motionFor('nope', 'kpi'), N);
  assert.deepEqual(motionFor('month', 'nope'), N);
  assert.deepEqual(motionFor(undefined, undefined), N);
  motionFor('month', 'donut').stagger = false;
  assert.equal(motionFor('month', 'donut').stagger, true);
});

test('motionTokens / applyMotion: data-motion 값', () => {
  assert.equal(motionTokens(F), 'fade');
  assert.equal(motionTokens(FS), 'fade grow');
  assert.equal(motionTokens(N), '');
  assert.equal(motionTokens(), '');
  const attrs = {};
  const el = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  applyMotion(el, FS);
  assert.equal(attrs['data-motion'], 'fade grow');
  applyMotion(el, N);
  assert.equal('data-motion' in attrs, false);
});

test('CSS: 모션 변수 값과 공용 keyframes', () => {
  const css = read('css/style.css');
  const vars = {
    '--motion-short': '150ms', '--motion-base': '220ms', '--motion-stagger': '30ms', '--motion-stagger-total': '300ms', '--motion-distance': '8px',
    '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)', '--ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)', '--ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  };
  for (const [k, v] of Object.entries(vars)) assert.ok(css.includes(`${k}: ${v};`), k);
  for (const name of ['mb-fade-in', 'mb-slide-in', 'mb-grow-x']) assert.match(css, new RegExp(`@keyframes ${name} \{`));
});

test('CSS: keyframes 는 from 만, 속성은 opacity·translate·transform 뿐, fill 은 backwards 만, !important animation 없음', () => {
  const css = read('css/style.css');
  const kfs = [...css.matchAll(/@keyframes ([\w-]+) \{([^]*?\})\s*\}/g)];
  assert.equal(kfs.length >= 3, true);
  for (const [, name, body] of kfs) {
    assert.doesNotMatch(body, /\b(to|\d+%)\s*\{/, `${name}: from 만`);
    assert.match(body, /^\s*from \{/, name);
    const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
    for (const p of props) assert.ok(['opacity', 'translate', 'transform'].includes(p), `${name}: ${p}`);
  }
  const noComments = css.replace(/\/\*[^]*?\*\//g, '');
  assert.doesNotMatch(noComments, /animation[^;]*\b(both|forwards)\b/);
  assert.doesNotMatch(noComments, /animation[^;]*!important/);
  assert.doesNotMatch(noComments, /animation-fill-mode:\s*(?!backwards)/);
  // 모든 animation 단축 속성의 시간·이징은 변수에서 온다
  for (const m of noComments.matchAll(/animation:\s*([^;]+);/g)) assert.match(m[1], /var\(--motion-(short|base)\)\s+var\(--ease-[\w-]+\)\s+backwards/, m[1]);
});

test('CSS: 패널은 opacity 만(transform·translate 없음), 토스트는 translate, 막대 지연 상한 공식', () => {
  const css = read('css/style.css').replace(/\/\*[^]*?\*\//g, '');
  const panel = css.match(/html\[data-motion-ready\] \.app-main > section\[id\^="panel-"\]\.panel--enter:not\(\[hidden\]\) \{([^}]*)\}/)[1];
  assert.match(panel, /mb-fade-in var\(--motion-short\)/);
  assert.doesNotMatch(panel, /transform|translate/);
  assert.match(css, /#toast \{ animation: mb-slide-in var\(--motion-base\)/);
  assert.match(css, /animation-delay: min\(calc\(var\(--motion-i, 0\) \* var\(--motion-stagger\)\), calc\(var\(--motion-stagger-total\) - var\(--motion-short\)\)\)/);
  assert.match(css, /\.chip--reveal \{ animation: mb-slide-in/);
});

test('JS: element.animate / animationend / transitionend 없음, 인라인 style 속성·style 태그·인라인 스크립트 없음', () => {
  const dir = new URL('../public/js/', import.meta.url);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]));
  for (const f of walk(dir)) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\.animate\(/, f.pathname);
    assert.doesNotMatch(src, /animationend|transitionend/, f.pathname);
    assert.doesNotMatch(src, /setAttribute\(\s*['"]style['"]/, f.pathname);
  }
  for (const f of ['index.html', 'login.html']) {
    const html = read(f);
    assert.doesNotMatch(html, /<style|\sstyle\s*=/i, f);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, f);
  }
});

test('tabs.js: 첫 화면은 움직이지 않고, 숨겨졌다 보이게 되는 패널에만 panel--enter', () => {
  const js = read('js/tabs.js');
  assert.match(js, /if \(ready && show && panel\.hidden\) panel\.classList\.add\('panel--enter'\)/);
  assert.match(js, /apply\(\);\s*ready = true;/);
  assert.match(js, /data-motion-ready/);
});

test('record.js: 더 보기를 눌렀을 때만 reveal, 토스트 이동 뒤 finish(), 타이머 로직은 그대로', () => {
  const js = read('js/record.js');
  assert.match(js, /renderCategoryChips\(\{ reveal: more \}\)/);
  assert.equal((js.match(/renderCategoryChips\(\{ reveal: /g) || []).length, 1);
  assert.match(js, /toast\.getAnimations\(\)\.forEach\(\(a\) => a\.finish\(\)\)/);
  assert.match(js, /const FLASH_MS = 4000;/);
  assert.match(js, /const UNDO_MS = 5000;/);
});

test('charts.js: 막대마다 --motion-i (CSSOM)', () => {
  assert.match(read('js/charts.js'), /fill\.style\.setProperty\('--motion-i', String\(i\)\)/);
});
