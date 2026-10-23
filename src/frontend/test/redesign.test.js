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

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('개선 A2: 토스트는 기록 탭에서 고정 저장 영역(.save-dock) 안 저장 버튼 위, 다른 탭은 탭바 위', () => {
  const css = read('css/style.css');
  assert.match(css, /#toast \{ top: auto; bottom: calc\(var\(--tabbar-h\)/);
  assert.match(css, /\.save-dock \{ position: sticky;[^}]*background: var\(--color-bg\)/);
  assert.match(css, /\.save-dock #toast \{ position: static;/);
  assert.match(css, /html:has\(#save-dock #flash:not\(:empty\)\) \{ --save-clearance/);
  assert.doesNotMatch(css, /#save-btn \{ position: sticky/);
  const html = read('index.html');
  assert.match(html, /<div class="save-dock" id="save-dock">\s*<button type="submit"[^>]*id="save-btn"/);
  assert.match(read('js/record.js'), /function placeToast\(tab\)/);
});

test('개선 A3: 지난달 비교가 둘 다 없으면 카드 아래 한 줄 문구', async () => {
  const { NO_PREV_ALL_TEXT, NO_PREV_TEXT } = await import('../public/js/lib/dashboard-data.js');
  assert.equal(NO_PREV_ALL_TEXT, '지난달 기록이 없어 비교하지 않아요');
  assert.equal(NO_PREV_TEXT, '비교할 지난달 기록이 없어요');
  assert.doesNotMatch(NO_PREV_ALL_TEXT, /과소비|더 썼|덜 썼|초과|⚠/);
  assert.match(read('js/dashboard.js'), /footnote: noneAtAll \? NO_PREV_ALL_TEXT : ''/);
});

test('개선 A4: 인사이트 CSS 규칙은 한 번만, 라벨은 숨김, 아이콘은 mask 클래스', () => {
  const css = read('css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['.insight', '.insight-section', '.insight-icon', '.insight.strong']) {
    const n = css.split('\n').filter((l) => l.startsWith(`${sel} {`)).length;
    assert.equal(n, 1, `${sel} 규칙 ${n}개`);
  }
  assert.match(css, /\.insight-label \{[^}]*clip: rect/);
  assert.match(read('js/insights.js'), /class: `insight-icon icon icon--\$\{ICON_CLASS/);
});

test('개선 A5: 세 차트 카드 모두 제목(h2)과 chart-card, 링크형 버튼 밑줄 없음', () => {
  const html = read('index.html');
  assert.equal((html.match(/class="card chart-card/g) || []).length, 3);
  assert.match(html, /<h2 id="trend-title">카테고리별 추이<\/h2>/);
  const css = read('css/style.css');
  assert.match(css, /a\.btn \{ text-decoration: none; \}/);
  assert.match(css, /\.chart-card \.chart-table > summary \{[^}]*position: absolute/);
  assert.match(css, /\.donut-card \.chart-summary \{[^}]*clip: rect/);
});

test('개선 A6·A7·A8: 세그먼트 선택 테두리, 격자선 중립색, 제목 포커스 링 없음', () => {
  const css = read('css/style.css');
  assert.match(css, /\.segmented__item\[aria-pressed="true"\] \{[^}]*inset 0 0 0 1px var\(--color-border\)/);
  assert.match(css, /\.chart-grid \{ stroke: color-mix\(in srgb, var\(--color-text-muted\) 25%, transparent\)/);
  assert.doesNotMatch(css, /\.chart-grid \{ stroke: var\(--color-line\)/);
  assert.match(css, /h1\[tabindex="-1"\]:focus[^{]*\{ outline: none; box-shadow: none; \}/);
});

test('개선 A9: 대시보드는 요청 종류별로 필요한 것만 다시 받는다', () => {
  const js = read('js/dashboard.js');
  assert.equal((js.match(/loadInsights\(/g) || []).length, 1); // 호출은 loadAll 안 한 곳뿐
  const loadAll = js.match(/function loadAll\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(loadAll, /loadInsights\(state\.base\)/);
  const setRange = js.match(/function setRange\(n\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(setRange, /loadInsights|loadCat\(/);
  assert.match(setRange, /loadMonthly\(\);\s*loadTrend\(\);/);
  const setCat = js.match(/function setCatType\(type\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(setCat, /loadInsights|loadMonthly/);
  assert.match(setCat, /loadTrend\(loadCat\(\)\)/);
});

test('개선 A10: record.js 정리', () => {
  const js = read('js/record.js');
  assert.doesNotMatch(js, /incomeCats/);
  assert.doesNotMatch(js.split('\n')[0], /인사이트/);
  assert.match(js, /document\.addEventListener\('tabchange', \(ev\) => \{\s*placeToast\(ev\.detail\.tab\);\s*if \(ev\.detail\.tab === 'record'\) markClamped/);
  const i = js.indexOf('저장 버튼 라벨');
  assert.ok(js.indexOf('function updateSaveLabel') > i && js.indexOf('function updateSaveLabel') - i < 400);
});

test('토스트 이동 뒤 멈춤 상태: 옛 hover/focus 는 버리고 실제로 위에 있을 때만 멈춘다', async () => {
  const { pausedAfterMove } = await import('../public/js/lib/undo.js');
  assert.equal(pausedAfterMove({}), false);
  assert.equal(pausedAfterMove({ hover: false, focusInside: false }), false);
  assert.equal(pausedAfterMove({ hover: true }), true);
  assert.equal(pausedAfterMove({ focusInside: true }), true);
  const js = read('js/record.js');
  const place = js.match(/function placeToast\(tab\) \{[\s\S]*?\n\}/)[0];
  assert.match(place, /toastPaused = pausedAfterMove\(\{ hover: toast\.matches\(':hover'\), focusInside: toast\.contains\(document\.activeElement\) \}\)/);
  assert.match(place, /armFlashTimer\(\)/);
});
