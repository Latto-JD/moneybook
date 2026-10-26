import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPRING, ymaxFor, clampScroll, scrollDelta, dragRatio, clampY, inject, advance, isSettled,
  scaleYFor, transformFor, isRecentTyping, median, originFor,
} from '../public/js/lib/spring.js';
import { UNITS } from '../public/js/scroll-spring.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

/** 20px 에서 놓았을 때 정지까지 걸린 시간(ms)과 되튐 비율(반대편으로 넘어간 최대치 / 시작 변위) */
function release(y0, frameMs = 1000 / 60) {
  let st = { y: y0, v: 0 };
  let t = 0;
  let overshoot = 0;
  while (!isSettled(st) && t < 5000) {
    st = advance(st, frameMs / 1000);
    t += frameMs;
    if (st.y * y0 < 0) overshoot = Math.max(overshoot, Math.abs(st.y));
  }
  return { t, overshoot: overshoot / Math.abs(y0) };
}

test('상한 값: 카드 20px, 행 12px', () => {
  assert.equal(ymaxFor('card'), 20);
  assert.equal(ymaxFor('row'), 12);
  assert.equal(SPRING.k, 170);
  assert.equal(SPRING.c, 14);
});

test('수렴: 20px 에서 놓으면 800ms 안에 멈춘다 (60Hz·120Hz·30Hz 모두)', () => {
  for (const ms of [1000 / 120, 1000 / 60, 1000 / 30]) {
    const { t } = release(20, ms);
    assert.ok(t <= 800, `${ms.toFixed(1)}ms 프레임: ${t.toFixed(0)}ms`);
  }
  assert.ok(release(-12).t <= 800);
});

test('되튐: 한 번 약 13% (5~20%)', () => {
  const { overshoot } = release(20, 1000 / 240);
  assert.ok(overshoot > 0.05 && overshoot < 0.2, `되튐 ${overshoot}`);
});

test('정지 판정: 작은 변위·속도만 정지, 이동 중이면 아님', () => {
  assert.equal(isSettled({ y: 0.1, v: 3 }), true);
  assert.equal(isSettled({ y: 0.2, v: 0 }), false);
  assert.equal(isSettled({ y: 0, v: 6 }), false);
});

test('큰 dt 는 50ms 로 잘린다', () => {
  const a = advance({ y: 20, v: 0 }, 10);
  const b = advance({ y: 20, v: 0 }, 0.05);
  assert.deepEqual(a, b);
  assert.deepEqual(advance({ y: 5, v: 1 }, 0), { y: 5, v: 1 });
  assert.deepEqual(advance({ y: 5, v: 1 }, -1), { y: 5, v: 1 });
});

test('끌림 비율: 기준점 바로 아래는 0, R 이상은 1, 멀수록 크다', () => {
  assert.equal(dragRatio(0), 0);
  assert.equal(dragRatio(250), 0.5);
  assert.equal(dragRatio(500), 1);
  assert.equal(dragRatio(5000), 1);
  assert.equal(dragRatio(-250), 0.5);
  const near = inject({ y: 0, v: 0 }, 10, 50, 20).y;
  const far = inject({ y: 0, v: 0 }, 10, 400, 20).y;
  assert.ok(near < far);
  assert.equal(inject({ y: 0, v: 0 }, 10, 0, 20).y, 0);
});

test('상한: 넘으면 잘라내고 속도는 0, 음수 쪽도 같다', () => {
  assert.deepEqual(inject({ y: 15, v: 100 }, 50, 1000, 20), { y: 20, v: 0 });
  assert.deepEqual(inject({ y: -10, v: 100 }, -50, 1000, 12), { y: -12, v: 0 });
  assert.deepEqual(inject({ y: 1, v: 7 }, 2, 1000, 20), { y: 3, v: 7 });
  assert.equal(clampY(99, 12), 12);
  assert.equal(clampY(-99, 12), -12);
});

test('연속 큰 스크롤에도 어떤 단계에서도 상한을 넘지 않는다', () => {
  for (const kind of ['card', 'row']) {
    const ymax = ymaxFor(kind);
    let st = { y: 0, v: 0 };
    for (let i = 0; i < 300; i++) {
      st = inject(st, 80, 1000, ymax);
      st = advance(st, 1 / 60);
      assert.ok(Math.abs(st.y) <= ymax + 1e-9, `${kind} ${st.y}`);
    }
  }
});

test('끝 튕김: 범위 밖 scrollY 는 잘라서 변화량이 0', () => {
  assert.equal(clampScroll(-30, 1000), 0);
  assert.equal(clampScroll(1040, 1000), 1000);
  assert.equal(scrollDelta(0, -25, 1000), 0);
  assert.equal(scrollDelta(1000, 1030, 1000), 0);
  assert.equal(scrollDelta(-10, 0, 1000), 0);
  assert.equal(scrollDelta(100, 130, 1000), 30);
  assert.equal(scrollDelta(100, 70, 1000), -30);
  assert.equal(scrollDelta(990, 1020, 1000), 10);
  assert.equal(clampScroll(5, -3), 0);
  assert.equal(inject({ y: 0, v: 0 }, scrollDelta(0, -25, 1000), 1000, 20).y, 0);
});

test('scaleY: 최대 1.5%, SMAX 0 이면 쓰지 않는다', () => {
  assert.equal(scaleYFor(0), 1);
  assert.ok(Math.abs(scaleYFor(1200) - 1.015) < 1e-9);
  assert.ok(Math.abs(scaleYFor(99999) - 1.015) < 1e-9);
  assert.ok(Math.abs(scaleYFor(-600) - 1.0075) < 1e-9);
  assert.match(transformFor({ y: 3.14159, v: 900 }), /^translate3d\(0, 3\.14px, 0\) scaleY\(1\.01\d+\)$/);
  assert.equal(transformFor({ y: -2, v: 0 }), 'translate3d(0, -2.00px, 0)');
  const saved = SPRING.SMAX;
  SPRING.SMAX = 0;
  try {
    assert.equal(scaleYFor(5000), 1);
    assert.doesNotMatch(transformFor({ y: 4, v: 5000 }), /scale/);
  } finally { SPRING.SMAX = saved; }
});

test('중앙값·늘어남 기준 가장자리', () => {
  assert.equal(median([]), 0);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(originFor(500, 300), 'top');
  assert.equal(originFor(100, 300), 'bottom');
});

test('입력 중 규칙: 마지막 input·keydown 뒤 800ms 안에서만 멈춘다 (포커스만으로는 아님)', () => {
  assert.equal(SPRING.TYPING_MS, 800);
  assert.equal(isRecentTyping(1000, 1000), true);
  assert.equal(isRecentTyping(1799, 1000), true);
  assert.equal(isRecentTyping(1800, 1000), false);
  assert.equal(isRecentTyping(5000, -1e9), false); // 입력한 적 없음 = 자동 포커스만
  assert.doesNotMatch(code, /document.activeElement/);
  assert.doesNotMatch(code, /'focusin'/);
});

test('느린 기기 규칙 값: 25ms 초과가 연속 2번', () => {
  assert.equal(SPRING.SLOW_FRAME_MS, 25);
  assert.equal(SPRING.SLOW_GESTURES, 2);
  assert.equal(SPRING.MAX_ACTIVE, 40);
  assert.equal(SPRING.enabled, true);
});

// ── 정적 검사 ──
const js = read('js/scroll-spring.js');
const code = js.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('정적: 금지 패턴이 없다', () => {
  for (const bad of [/\.animate\(/, /animationend/, /transitionend/, /setInterval/, /setTimeout/, /getAnimations/]) {
    assert.doesNotMatch(code, bad, String(bad));
  }
  assert.doesNotMatch(code, /\.style\.(pointerEvents|visibility)|\binert\b|tabindex/i);
  assert.doesNotMatch(code, /setAttribute\('style'|\.cssText|innerHTML/);
});

test('정적: 모든 이벤트 리스너는 passive 이고 해제 가능하다 (matchMedia change 제외)', () => {
  const calls = code.match(/addEventListener\([^)]*\)/g) || [];
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    if (/'change'/.test(c)) continue;
    assert.match(c, /passive: true/, c);
  }
  for (const type of ['scroll', 'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'keydown', 'input']) {
    assert.match(code, new RegExp(`on\\((window|document), '${type}'`), type);
  }
  assert.match(code, /removeEventListener/);
});

test('정적: 움직임 줄이기와 단일 스위치를 확인한다', () => {
  assert.match(code, /prefers-reduced-motion: reduce/);
  assert.match(code, /if \(!SPRING\.enabled\) return;/);
  assert.match(code, /mql\.addEventListener\('change'/);
});

test('정적: 유닛 선택자에 제외 요소가 없다', () => {
  const excluded = ['app-header', 'tabbar', 'toast', 'save-dock', 'tx-form', 'account-form', 'catm-add', 'panel-', '#main', 'body', 'html', 'page-head', 'dash-head', 'cat-top', 'month-nav', 'logout-btn'];
  assert.ok(UNITS.length >= 10);
  for (const [sel, kind] of UNITS) {
    assert.ok(kind === 'card' || kind === 'row', sel);
    for (const x of excluded) assert.ok(!sel.includes(x), `${sel} 에 ${x}`);
  }
  const sels = UNITS.map(([s]) => s);
  for (const need of ['#month-totals', '#quick-section', '#tx-list .tx-date', '#tx-list .tx-row', '#kpi', '.donut-card', '.insights-card', '.account-card']) {
    assert.ok(sels.includes(need), need);
  }
  // 거래 목록은 행마다 따로(카드 통째로 아님), 대시보드는 카드 단위
  assert.equal(UNITS.find(([s]) => s === '#tx-list .tx-row')[1], 'row');
  assert.equal(UNITS.find(([s]) => s === '#kpi')[1], 'card');
});

test('정적: 스타일시트는 유닛에 transform·translate·transition·animation 규칙을 두지 않는다', () => {
  const tokens = ['#month-totals', '#quick-section', '.tx-date', '.tx-row', '#kpi', '.donut-card', '.insights-card', '.chart-card', '.cat-row', '.account-card'];
  const esc = (s) => s.replace(/[.#]/g, '\\$&');
  for (const f of ['css/style.css', 'css/components.css']) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sels, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      if (!/(^|[;\s])(transform|translate|transition|animation)\s*:/.test(body)) continue;
      for (const sel of sels.split(',')) {
        for (const t of tokens) {
          const last = new RegExp(`(^|[\\s>+~])${esc(t)}(\\.[\\w-]+|\\[[^\\]]*\\]|:[\\w-]+(\\([^)]*\\))?)*$`);
          assert.ok(!last.test(sel.trim()), `${f}: ${sel.trim()} {${body.trim()}}`);
        }
      }
    }
  }
});

test('정적: index.html 의 유닛 위치가 제외 요소 안에 있지 않다 (#tx-form 안에 유닛 없음)', () => {
  const html = read('index.html');
  const form = html.slice(html.indexOf('<form class="stack record-form"'), html.indexOf('</form>'));
  for (const id of ['month-totals', 'quick-section', 'tx-list', 'kpi']) assert.ok(!form.includes(`id="${id}"`), id);
  assert.doesNotMatch(form, /class="[^"]*(tx-row|tx-date|donut-card|chart-card)/);
});

test('app.js 가 한 번 import 한다', () => {
  assert.match(read('js/app.js'), /import '\.\/scroll-spring\.js';/);
});
