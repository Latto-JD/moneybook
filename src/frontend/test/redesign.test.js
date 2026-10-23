import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gridView, selectedHidden } from '../public/js/lib/category-grid.js';
import { amountAria } from '../public/js/lib/summary-data.js';

const names = (n) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

test('gridView: 0·1·8개는 모두 보이고 버튼 없음', () => {
  for (const n of [0, 1, 8]) {
    const v = gridView(names(n), '', false);
    assert.deepEqual(v, { visible: names(n), hiddenCount: 0, toggle: null }, String(n));
  }
});

test('gridView: 9개는 7개 + 더 보기(2), 펼치면 9개 + 접기', () => {
  const v = gridView(names(9), '', false);
  assert.equal(v.visible.length, 7);
  assert.equal(v.hiddenCount, 2);
  assert.equal(v.toggle, 'more');
  const e = gridView(names(9), '', true);
  assert.deepEqual([e.visible.length, e.hiddenCount, e.toggle], [9, 0, 'less']);
});

test('gridView: 30개는 7개 + 더 보기(23), 펼치면 30개', () => {
  const v = gridView(names(30), 'c1', false);
  assert.deepEqual([v.visible.length, v.hiddenCount, v.toggle], [7, 23, 'more']);
  assert.equal(gridView(names(30), 'c1', true).visible.length, 30);
});

test('gridView: 선택이 접힌 부분에 있으면 접지 않는다(접기 버튼 없음), 보이는 부분이면 접힌 채', () => {
  assert.equal(selectedHidden(names(9), 'c8'), true);
  assert.equal(selectedHidden(names(9), 'c7'), false);
  assert.equal(selectedHidden(names(8), 'c8'), false);
  assert.equal(selectedHidden(names(9), ''), false);
  const v = gridView(names(9), 'c9', false);
  assert.deepEqual([v.visible.length, v.hiddenCount, v.toggle], [9, 0, null]);
  assert.equal(gridView(names(9), 'c7', false).toggle, 'more');
});

test('gridView: 잘못된 입력은 빈 목록', () => {
  assert.deepEqual(gridView(null, '', false), { visible: [], hiddenCount: 0, toggle: null });
});

test('amountAria: 이번 달 수입 0원 / 앞말 없으면 수입 0원', () => {
  assert.equal(amountAria('이번 달', '수입', '0원'), '이번 달 수입 0원');
  assert.equal(amountAria('', '지출', '877,530원'), '지출 877,530원');
});

test('HTML: 헤더에 로그아웃 없음(내 정보에 있음), 이름 링크는 › 아이콘 포함, 인사이트는 대시보드에', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const header = html.match(/<header class="app-header">[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(header, /logout-btn/);
  assert.match(header, /id="user-name" href="#account"><span class="user__text" id="user-name-text"><\/span><span class="icon icon--chevron" aria-hidden="true">/);
  const account = html.match(/<section id="panel-account"[\s\S]*?<\/section>\s*(?=<\/main>)/)[0];
  assert.match(account, /id="logout-btn"/);
  const record = html.match(/<section id="panel-record"[\s\S]*?<!-- 대시보드 탭 -->/)[0];
  const dash = html.match(/<section id="panel-dashboard"[\s\S]*?<!-- 카테고리 관리/)[0];
  assert.doesNotMatch(record, /id="insights"/);
  assert.match(dash, /id="insights"/);
});

test('HTML: 기록 폼은 카드 밖, 카테고리는 격자, 메모는 placeholder + 숨긴 라벨', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const form = html.match(/<form[^>]*id="tx-form"[^>]*>/)[0];
  assert.doesNotMatch(form, /class="[^"]*\bcard\b/);
  assert.match(html, /<ul class="cat-grid" id="category-chips">/);
  assert.match(html, /<label for="memo" class="visually-hidden">메모 \(선택\)<\/label>/);
  assert.match(html, /id="memo"[^>]*placeholder="메모 \(선택\)"/);
  assert.match(html, /id="month-totals" aria-label="이번 달 요약"/);
});

test('아이콘·스타일: logout.svg 존재(메타데이터 없음), style.css 에 hex·rgb 색 없음, 4열 격자', () => {
  const svg = readFileSync(new URL('../public/icons/logout.svg', import.meta.url), 'utf8');
  assert.match(svg, /^<svg /);
  assert.doesNotMatch(svg, /metadata|data:|https?:\/\/(?!www\.w3\.org)/);
  assert.equal(existsSync(new URL('../public/icons/logout.svg', import.meta.url)), true);
  const css = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.match(css, /\.cat-grid \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test('CSS: Newsreader 금액은 굵기 400, 비율 줄은 tabular, 도넛은 글자가 11px 이상이 되는 크기', () => {
  const css = readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.sum-amount \{[^}]*font-weight: var\(--fw-regular\)/);
  assert.match(css, /\.balance-rate \{[^}]*font-variant-numeric: tabular-nums/);
  const w = Number(css.match(/\.donut-body \.chart-svg \{ max-width: (\d+)px/)[1]);
  assert.ok((13 * w) / 200 >= 11, `chart-text 13px -> ${(13 * w) / 200}px`);
});
