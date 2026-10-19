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
  // 조각마다 서로 다른 fill (패턴 포함)
  const fills = svg.children.filter((p) => p.tag === 'path').map((p) => p.attrs.fill);
  assert.equal(new Set(fills).size, 3);
  assert.ok(fills.some((f) => f.startsWith('url(#')));
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

test('묶은 막대: 수입 패턴 vs 지출 단색, 범례 텍스트, 잔액 열', () => {
  const root = mount();
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) => ({
    month: m, incomeTotal: 3000000, expenseTotal: 1000000 * (i % 3), balance: 3000000 - 1000000 * (i % 3), count: 3,
  }));
  renderGroupedBars(root, { title: '월별 수입 vs 지출', months });
  const fig = root.children[0];
  const svg = byTag(fig, 'svg').find((e) => e.attrs.role === 'img');
  const fills = new Set(byTag(svg, 'rect').map((r) => r.attrs.fill).filter((f) => f && f !== '#fff'));
  assert.ok([...fills].some((f) => f.startsWith('url(#')));
  assert.ok([...fills].some((f) => f.startsWith('#')));
  const legend = byTag(fig, 'li').map((l) => l.textContent).join('|');
  assert.match(legend, /수입/);
  assert.match(legend, /지출/);
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

test('정적 HTML: viewport, 인라인 스크립트/핸들러/style 없음, 외부 URL 없음, select 없음', () => {
  for (const f of ['index.html', 'login.html']) {
    const html = readFileSync(fileURLToPath(new URL(`../public/${f}`, import.meta.url)), 'utf8');
    assert.match(html, /<meta name="viewport"/, f);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\bsrc="/, `${f}: inline script`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${f}: inline handler`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${f}: inline style`);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//i, `${f}: external url`);
    assert.doesNotMatch(html, /<select/i, f);
    // 모든 input 은 label[for] 로 연결
    for (const m of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      if (/type="(checkbox)"/.test(m[0])) continue;
      assert.match(html, new RegExp(`<label[^>]*for="${m[1]}"`), `${f}: label for ${m[1]}`);
    }
  }
});
