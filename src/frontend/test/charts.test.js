// 차트 컴포넌트를 최소 가짜 DOM 위에서 렌더링해 구조를 검증한다 (실제 브라우저 렌더링은 아님).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

class FakeEl {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...cs) { this.children = cs; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk(fn)); }
  all(pred) { const out = []; this.walk((e) => pred(e) && out.push(e)); return out; }
}
globalThis.document = {
  createElement: (t) => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
};
const { renderDonut, renderGroupedBars, renderBars, EMPTY_TEXT } = await import('../public/js/charts.js');

const BAD = /NaN|undefined|Infinity/;
const mount = () => new FakeEl('div');
const byTag = (root, tag) => root.all((e) => e.tag === tag);

test('도넛: figure/role=img/표/범례 순서/패턴', () => {
  const root = mount();
  renderDonut(root, {
    title: '카테고리 지출 비중', periodLabel: '2026년 10월',
    items: [{ label: '교통', value: 300000 }, { label: '식비', value: 400000 }, { label: '쇼핑', value: 0 }, { label: '카페/간식', value: 100000 }],
  });
  const fig = root.children[0];
  assert.equal(fig.tag, 'figure');
  assert.equal(byTag(fig, 'figcaption').length, 1);
  const svg = byTag(fig, 'svg').find((e) => e.attrs.role === 'img');
  assert.ok(svg && svg.attrs['aria-labelledby']);
  assert.equal(byTag(svg, 'title').length, 1);
  // 범례: 금액 내림차순 + 카테고리명·금액·비율 텍스트
  const items = byTag(fig, 'li').map((li) => li.textContent);
  assert.deepEqual(items, ['식비400,000원50.0%', '교통300,000원37.5%', '카페/간식100,000원12.5%']);
  // 표 대체: caption, th[scope], 표 합계
  const table = byTag(fig, 'table')[0];
  assert.equal(byTag(table, 'caption').length, 1);
  assert.ok(byTag(table, 'th').every((th) => th.attrs.scope === 'col' || th.attrs.scope === 'row'));
  assert.equal(byTag(table, 'tr').length, 5); // head + 3 + 합계
  // 조각마다 서로 다른 (색,무늬) 번호: data-viz. 1번은 단색 클래스, 2..8 은 무늬 패턴 fill
  const paths = svg.children.filter((p) => p.tag === 'path');
  assert.equal(new Set(paths.map((p) => p.attrs['data-viz'])).size, 3);
  assert.ok(paths.some((p) => p.attrs.fill && p.attrs.fill.startsWith('url(#')));
  assert.ok(paths.every((p) => /\bdonut__slice\b/.test(p.attrs.class)));
  assert.match(fig.textContent, /2026년 10월 지출 800,000원 중 식비 50\.0%로 가장 큼/);
  assert.doesNotMatch(fig.textContent, BAD);
});

test('도넛: 데이터 없음/합계 0 -> 빈 상태 문구', () => {
  for (const items of [[], [{ label: 'a', value: 0 }], undefined]) {
    const root = mount();
    renderDonut(root, { title: 't', items });
    assert.equal(root.children[0].textContent, EMPTY_TEXT);
    assert.equal(byTag(root, 'svg').length, 0);
  }
});

test('묶은 막대: 수입·지출 모두 서로 다른 무늬(같은 밀도), 범례 텍스트, 잔액 열', () => {
  const root = mount();
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) => ({
    month: m, incomeTotal: 3000000, expenseTotal: 1000000 * (i % 3), balance: 3000000 - 1000000 * (i % 3), count: 3,
  }));
  renderGroupedBars(root, { title: '월별 수입 vs 지출', months });
  const fig = root.children[0];
  const svg = byTag(fig, 'svg').find((e) => e.attrs.role === 'img');
  const fills = new Set(svg.children.filter((e) => e.tag === 'rect').map((r) => r.attrs.fill)); // 막대만 (패턴 안 rect 제외)
  assert.equal(fills.size, 2);
  assert.ok([...fills].every((f) => f.startsWith('url(#'))); // 어느 쪽도 단색이 아니다
  const patterns = byTag(svg, 'pattern');
  assert.equal(patterns.length, 2);
  assert.equal(new Set(patterns.map((p) => p.attrs.id)).size, 2);
  // 두 무늬는 같은 개수의 선(밀도)을 가진다
  const strokes = patterns.map((p) => byTag(p, 'path').map((x) => (x.attrs.d.match(/M/g) || []).length));
  assert.deepEqual(strokes[0], strokes[1]);
  const legend = byTag(fig, 'li').map((l) => l.textContent).join('|');
  assert.match(legend, /수입 \(\/ 무늬\)/);
  assert.match(legend, /지출 \(\\ 무늬\)/);
  assert.doesNotMatch(legend, /단색/);
  const heads = byTag(byTag(fig, 'thead')[0], 'th').map((t) => t.textContent);
  assert.deepEqual(heads, ['월', '수입', '지출', '잔액']);
  assert.equal(byTag(byTag(fig, 'tbody')[0], 'tr').length, 6);
  assert.equal(byTag(svg, 'text').some((t) => t.textContent === '5월'), true);
  assert.doesNotMatch(fig.textContent, BAD);
});

test('묶은 막대: 12개월은 월 레이블 격월, 표에는 전체 12행', () => {
  const root = mount();
  const months = [];
  for (let i = 0; i < 12; i++) months.push({ month: `2026-${String(i + 1).padStart(2, '0')}`, incomeTotal: 100000 + i, expenseTotal: 50000, balance: 1 });
  renderGroupedBars(root, { title: 't', months });
  const fig = root.children[0];
  const svg = byTag(fig, 'svg').find((e) => e.attrs.role === 'img');
  const xLabels = byTag(svg, 'text').filter((t) => /월$/.test(t.textContent));
  assert.equal(xLabels.length, 6);
  assert.equal(byTag(byTag(fig, 'tbody')[0], 'tr').length, 12);
});

test('묶은 막대: 모두 0 이거나 빈 배열이면 빈 상태', () => {
  for (const months of [[], [{ month: '2026-10', incomeTotal: 0, expenseTotal: 0, balance: 0 }], undefined]) {
    const root = mount();
    renderGroupedBars(root, { title: 't', months });
    assert.equal(root.children[0].textContent, EMPTY_TEXT);
  }
});

test('막대: 카테고리 월 추이 + 표 + 0/NaN 안전', () => {
  const root = mount();
  renderBars(root, { title: '식비 월별 추이', seriesName: '식비', months: ['2026-08', '2026-09', '2026-10'], totals: [100000, 0, NaN] });
  const fig = root.children[0];
  assert.equal(byTag(byTag(fig, 'tbody')[0], 'tr').length, 3);
  assert.doesNotMatch(fig.textContent, BAD);
  const empty = mount();
  renderBars(empty, { title: 't', seriesName: 's', months: ['2026-10'], totals: [0] });
  assert.equal(empty.children[0].textContent, EMPTY_TEXT);
});

test('정적 HTML: viewport, 인라인 스크립트/핸들러/style 없음, 외부 URL 없음, select 는 화면 모드만', () => {
  for (const f of ['index.html', 'login.html']) {
    const html = readFileSync(fileURLToPath(new URL(`../public/${f}`, import.meta.url)), 'utf8');
    assert.match(html, /<meta name="viewport"/, f);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\bsrc="/, `${f}: inline script`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${f}: inline handler`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${f}: inline style`);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//i, `${f}: external url`);
    // select 는 헤더의 화면 모드 선택(#theme-select)만 허용
    for (const m of html.matchAll(/<select\b[^>]*>/gi)) assert.match(m[0], /id="theme-select"/, `${f}: select`);
    // 모든 input 은 label[for] 로 연결
    for (const m of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      if (/type="(checkbox)"/.test(m[0])) continue;
      assert.match(html, new RegExp(`<label[^>]*for="${m[1]}"`), `${f}: label for ${m[1]}`);
    }
  }
});

const { groupDonutItems } = await import('../public/js/lib/dashboard-data.js');

const many = (n) => Array.from({ length: n }, (_, i) => ({ label: `카테고리${i + 1}`, value: 1000 * (n - i) }));

test('도넛 묶음: 8개 이하는 그대로, 9개부터 상위 7 + "그 외 N개"', () => {
  assert.equal(groupDonutItems(many(8)).length, 8);
  assert.ok(groupDonutItems(many(8)).every((x) => !x.members));
  assert.deepEqual(groupDonutItems([]), []);
  assert.deepEqual(groupDonutItems(undefined), []);
  for (const n of [9, 12, 30]) {
    const g = groupDonutItems(many(n));
    assert.equal(g.length, 8, `n=${n}`);
    assert.equal(g[7].label, `그 외 ${n - 7}개`);
    assert.notEqual(g[7].label, '기타');
    assert.equal(g[7].members.length, n - 7);
    assert.equal(g.reduce((a, x) => a + x.value, 0), many(n).reduce((a, x) => a + x.value, 0)); // 합계 보존
    assert.deepEqual(g.slice(0, 7).map((x) => x.label), many(n).slice(0, 7).map((x) => x.label));
  }
  // 입력이 정렬되어 있지 않아도 금액순, 0 이하는 제외
  const shuffled = [{ label: 'a', value: 1 }, { label: 'b', value: 0 }, ...many(9).reverse()];
  const g = groupDonutItems(shuffled);
  assert.equal(g[0].label, '카테고리1');
  assert.equal(g[7].members.length, 3); // 9 + a(1) - 7
});

test('도넛 묶음 렌더: 조각 8개, 조각마다 (색,무늬) 다름, 범례 8행 + 묶인 이름, 표는 전체 행 + 합계', () => {
  const items = many(12);
  items.splice(2, 0, { label: '기타', value: 1 }); // 사용자 카테고리 "기타" 가 묶음에 들어가도 이름이 충돌하지 않는다
  const total = items.reduce((a, x) => a + x.value, 0);
  const root = mount();
  renderDonut(root, { title: '카테고리 지출 비중', periodLabel: '2026년 10월', items: groupDonutItems(items) });
  const fig = root.children[0];
  const svg = byTag(fig, 'svg').find((e) => e.attrs.role === 'img');
  const paths = svg.children.filter((p) => p.tag === 'path');
  assert.equal(paths.length, 8);
  assert.equal(new Set(paths.map((p) => p.attrs['data-viz'])).size, 8);
  // 묶음 조각은 마지막, 무늬 없는 중립 단색 (다른 조각 번호 1..7 과 겹치지 않는다)
  assert.equal(paths[7].attrs['data-viz'], 'other');
  assert.match(paths[7].attrs.class, /\bviz-other\b/);
  assert.equal(paths[7].attrs.fill, undefined);
  assert.deepEqual(paths.slice(0, 7).map((p) => p.attrs['data-viz']), ['1', '2', '3', '4', '5', '6', '7']);
  assert.equal(byTag(svg, 'pattern').length, 6); // 번호 2..7 만 무늬 (1번은 단색)
  // 범례
  const legend = byTag(fig, 'ol')[0];
  const rows = byTag(legend, 'li');
  assert.equal(rows.length, 8);
  assert.match(rows[7].textContent, /^그 외 6개/);
  assert.ok(rows[7].children.some((c) => c.attrs.class === 'legend-members' && c.textContent.includes('기타')));
  // 표: 묶지 않은 전체 13행 + 합계, 금액 합 = 전체
  const table = byTag(fig, 'table')[0];
  const body = byTag(byTag(table, 'tbody')[0], 'tr');
  assert.equal(body.length, 13);
  assert.ok(!body.some((r) => /그 외/.test(r.textContent)));
  const foot = byTag(byTag(table, 'tfoot')[0], 'tr')[0];
  assert.match(foot.textContent, new RegExp(`합계${total.toLocaleString('ko-KR')}원100\\.0%`));
  const sum = body.reduce((a, r) => a + Number(byTag(r, 'td')[0].textContent.replace(/[^\d]/g, '')), 0);
  assert.equal(sum, total);
  assert.doesNotMatch(fig.textContent, BAD);
});

test('도넛: 수입 보기는 중심 라벨/문장이 수입', () => {
  const root = mount();
  renderDonut(root, { title: '카테고리 수입 비중', periodLabel: '2026년 10월', items: [{ label: '급여', value: 3000000 }], centerLabel: '총 수입', noun: '수입' });
  const txt = root.children[0].textContent;
  assert.match(txt, /총 수입/);
  assert.match(txt, /수입 3,000,000원 중 급여 100\.0%/);
  assert.doesNotMatch(txt, /지출/);
});

// 새 토큰(tokens.css) 기준 대비: 라이트는 :root 블록, 다크는 prefers-color-scheme 블록을 읽는다
const tokens = readFileSync(fileURLToPath(new URL('../public/css/tokens.css', import.meta.url)), 'utf8');
const darkAt = tokens.indexOf('@media (prefers-color-scheme: dark)');
const lightBlock = tokens.slice(0, darkAt);
const darkBlock = tokens.slice(darkAt, tokens.indexOf(':root[data-theme="dark"]'));
const tokenOf = (block, name) => block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('viz 1..8 과 수입/지출 색이 카드 배경 대비 3:1 이상, 중립(그 외) 색은 4.5:1 이상 (라이트·다크)', () => {
  for (const [mode, block] of [['light', lightBlock], ['dark', darkBlock]]) {
    const surface = tokenOf(block, '--color-surface');
    const colors = Array.from({ length: 8 }, (_, i) => tokenOf(block, `--viz-${i + 1}`));
    colors.forEach((c, i) => assert.ok(contrast(c, surface) >= 3, `${mode} viz-${i + 1} ${c} ${contrast(c, surface).toFixed(2)}`));
    assert.equal(new Set(colors).size, 8, `${mode}: 8색이 모두 다르다`);
    for (const t of ['--color-income', '--color-expense']) assert.ok(contrast(tokenOf(block, t), surface) >= 3, `${mode} ${t}`);
    assert.ok(contrast(tokenOf(block, '--color-text-muted'), surface) >= 4.5, `${mode} 중립색`);
  }
});
