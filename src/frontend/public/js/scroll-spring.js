// 스크롤 출렁임 구동기: 사용자 스크롤(터치·휠·트랙패드) 때 카드·목록 행이 늦게 따라오다 젤리처럼 제자리로 돌아온다.
// 물리는 lib/spring.js. 여기서는 유닛(아래 UNITS)의 inline transform 만 CSSOM 으로 쓴다.
// 폼·저장 영역·토스트·탭바·헤더·패널·#main 에는 transform 을 넣지 않는다 (조상 transform 은 fixed/sticky 기준을 바꾼다).
// JS 가 쓰는 inline transform 은 전역 prefers-reduced-motion CSS 규칙으로 꺼지지 않으므로 여기서 직접 끈다.
import { SPRING, isRecentTyping, ymaxFor, scrollDelta, inject, advance, isSettled, transformFor, median, originFor } from './lib/spring.js';

/** 출렁이는 유닛 선택자 [선택자, 종류]. 유닛끼리는 조상·자손이 아니어야 한다. 이 목록 한 곳에만 둔다. */
export const UNITS = [
  ['#month-totals', 'card'],
  ['#quick-section', 'card'],
  ['#tx-list .tx-date', 'row'],
  ['#tx-list .tx-row', 'row'],
  ['#hist-summary', 'card'],
  ['#hist-list .tx-date', 'row'],
  ['#hist-list .tx-row', 'row'],
  ['#kpi', 'card'],
  ['.donut-card', 'card'],
  ['.insights-card', 'card'],
  ['.chart-card:has(> #chart-monthly)', 'card'],
  ['.chart-card:has(> #chart-cat-trend)', 'card'],
  ['#catm-active > .cat-row', 'row'],
  ['#catm-inactive > .cat-row', 'row'],
  ['.account-card', 'card'],
];

/** 안쪽 내용이 다시 그려지는 컨테이너 (유닛 추가·제거 감시) */
const WATCH = ['#tx-list', '#hist-list', '#hist-summary', '#catm-active', '#catm-inactive', '#kpi', '#chart-donut', '#insights', '#chart-monthly', '#chart-cat-trend'];

const REDUCED = '(prefers-reduced-motion: reduce)';
const root = () => document.documentElement;

let S = null; // 켜져 있는 동안의 상태 (끄면 null)
let slowCount = 0;
let autoOff = false;

function isTyping(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'image'].includes(el.type);
  return false;
}

function clearUnit(u) {
  u.y = 0; u.v = 0;
  if (u.hot) {
    u.el.style.transform = '';
    u.el.style.transformOrigin = '';
    u.hot = false; u.written = ''; u.origin = '';
  }
}

function resetAll() {
  if (S) for (const u of S.units.values()) clearUnit(u);
}

function markStale() {
  for (const u of S.units.values()) u.stale = true;
}

function discover() {
  const found = new Set();
  for (const [sel, kind] of UNITS) {
    for (const el of document.querySelectorAll(sel)) {
      found.add(el);
      if (S.units.has(el)) continue;
      S.units.set(el, { el, kind, y: 0, v: 0, top: 0, h: 0, stale: true, inView: false, hot: false, written: '', origin: '' });
      el.setAttribute('data-spring-unit', ''); // style.css 가 기준 transform(0)을 상시 건다: 스크롤 중에 붙이고 떼는 레이아웃을 없앤다
      S.io.observe(el);
    }
  }
  for (const [el, u] of S.units) {
    if (found.has(el)) continue;
    S.io.unobserve(el);
    clearUnit(u);
    el.removeAttribute('data-spring-unit');
    S.units.delete(el);
  }
}

function schedule() {
  if (!S || S.raf) return;
  S.raf = requestAnimationFrame(frame);
  root().setAttribute('data-spring', 'running');
}

function stop() {
  if (!S) return;
  S.raf = 0; S.prevTs = 0;
  closeGesture();
  root().removeAttribute('data-spring');
}

/** 제스처 창: 휠은 마지막 wheel 뒤 150ms, 터치는 누르는 중이거나 뗀 뒤 관성 동안 스크롤 이벤트가 100ms 안에 계속 올 때 */
function gestureActive(ts) {
  if (ts - S.lastWheelAt < SPRING.WHEEL_GAP_MS) return true;
  return (S.touching || S.inertia) && ts - S.lastScrollAt < SPRING.TOUCH_GAP_MS;
}

/** 제스처 하나가 끝났을 때: 프레임 간격 중앙값이 느리면 횟수를 센다. 연속 2번이면 이 세션에서 끈다. */
function closeGesture() {
  if (!S.gestureOpen) return;
  S.gestureOpen = false;
  const samples = S.samples;
  S.samples = [];
  if (samples.length < 5) return;
  slowCount = median(samples) > SPRING.SLOW_FRAME_MS ? slowCount + 1 : 0;
  if (slowCount >= SPRING.SLOW_GESTURES) {
    autoOff = true;
    teardown();
  }
}

function frame(ts) {
  if (!S) return;
  S.raf = 0;

  // 읽기: scrollY 와 문서 높이. 유닛 위치는 캐시를 쓰고, 변위가 0 인 유닛만 새로 잰다.
  const sy = window.scrollY;
  const max = document.scrollingElement.scrollHeight - window.innerHeight;
  const vh = window.innerHeight;
  const refY = S.refY == null ? vh / 2 : S.refY;
  let list = [];
  for (const u of S.units.values()) {
    if (!u.inView && !u.hot) continue; // 화면 밖으로 나간 유닛도 변환을 가진 동안은 계속 복원한다 (정리는 완전히 멈춘 뒤 한 번에)
    if (u.stale && !u.hot) {
      const r = u.el.getBoundingClientRect();
      u.top = r.top + sy; u.h = r.height; u.stale = false;
    }
    list.push(u);
  }

  // 계산
  const typing = isRecentTyping(ts, S.lastTypeAt);
  const active = !typing && gestureActive(ts);
  const delta = active ? scrollDelta(S.prevScroll, sy, max) : 0;
  S.prevScroll = sy;
  const dt = S.prevTs ? (ts - S.prevTs) / 1000 : 1 / 60;
  if (active) {
    if (S.prevTs) S.samples.push(ts - S.prevTs);
    S.gestureOpen = true;
    if (delta !== 0) S.lastInjectTs = ts;
  } else {
    closeGesture();
    if (!S) return; // 느린 기기로 판정되어 꺼짐
  }
  S.prevTs = ts;

  const center = (u) => u.top + u.h / 2 - sy;
  if (list.length > SPRING.MAX_ACTIVE) {
    list.sort((p, q) => Math.abs(center(p) - refY) - Math.abs(center(q) - refY));
    for (const u of list.slice(SPRING.MAX_ACTIVE)) clearUnit(u);
    list = list.slice(0, SPRING.MAX_ACTIVE);
  }
  const hardStop = ts - S.lastInjectTs > SPRING.HARD_STOP_MS;
  let moving = false;
  for (const u of list) {
    let st = { y: u.y, v: u.v };
    if (delta !== 0 && u.inView) st = inject(st, delta, center(u) - refY, ymaxFor(u.kind));
    if (st.y !== 0 || st.v !== 0) st = advance(st, dt);
    if (hardStop || isSettled(st)) st = { y: 0, v: 0 };
    else moving = true;
    u.y = st.y; u.v = st.v;
  }

  // 쓰기: 읽기는 모두 끝났다. 쓴 뒤에는 이 프레임에서 아무것도 읽지 않는다.
  // 변환을 붙이고 떼는 일은 레이아웃을 만든다. 그래서 제스처 동안에는 한 번 붙인 유닛에 값만 바꾸고(0 이면 translate 0),
  // 떼는 것은 전체가 멈춘 뒤 한 프레임에 몰아서 한다.
  const cont = moving || (active && ts - S.lastScrollAt < SPRING.TOUCH_GAP_MS);
  for (const u of list) {
    if (!u.hot && !(active && u.inView)) continue;
    const text = transformFor({ y: u.y, v: u.v });
    u.hot = true;
    const origin = originFor(center(u), refY);
    if (origin !== u.origin) { u.el.style.transformOrigin = origin; u.origin = origin; }
    if (text !== u.written) { u.el.style.transform = text; u.written = text; }
  }
  if (cont) schedule();
  else {
    for (const u of list) clearUnit(u);
    stop();
  }
}

function setup() {
  if (S || autoOff) return;
  S = {
    units: new Map(), raf: 0, prevTs: 0, prevScroll: window.scrollY, refY: null,
    touching: false, inertia: false, lastScrollAt: 0, lastWheelAt: -1e9, lastTypeAt: -1e9, lastInjectTs: 0,
    gestureOpen: false, samples: [], off: [], io: null, mo: null, ro: null,
  };
  const on = (target, type, fn) => {
    target.addEventListener(type, fn, { passive: true });
    S.off.push(() => target.removeEventListener(type, fn));
  };

  S.io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const u = S.units.get(e.target);
      if (!u) continue;
      u.inView = e.isIntersecting;
    }
  }, { rootMargin: '25% 0px' });
  S.mo = new MutationObserver(() => { discover(); markStale(); });
  for (const sel of WATCH) {
    const el = document.querySelector(sel);
    if (el) S.mo.observe(el, { childList: true });
  }
  const main = document.getElementById('main');
  if (main) {
    S.ro = new ResizeObserver(() => markStale());
    S.ro.observe(main);
  }
  discover();

  on(window, 'scroll', () => {
    const now = performance.now();
    if (S.inertia && now - S.lastScrollAt >= SPRING.TOUCH_GAP_MS) S.inertia = false;
    S.lastScrollAt = now;
    const user = S.touching || S.inertia || now - S.lastWheelAt < SPRING.WHEEL_GAP_MS;
    if (user && !isRecentTyping(now, S.lastTypeAt)) schedule();
    else if (!S.raf) S.prevScroll = window.scrollY; // 키보드·프로그램 스크롤: 위치만 갱신
  });
  on(window, 'wheel', (e) => {
    if (e.ctrlKey) return;
    S.lastWheelAt = performance.now();
    S.refY = e.clientY;
    if (!isRecentTyping(S.lastWheelAt, S.lastTypeAt)) schedule();
  });
  on(window, 'touchstart', (e) => {
    S.touching = true; S.inertia = false;
    if (e.touches[0]) S.refY = e.touches[0].clientY;
  });
  on(window, 'touchmove', (e) => { if (e.touches[0]) S.refY = e.touches[0].clientY; });
  const touchEnd = (e) => {
    S.touching = e.touches.length > 0;
    if (!S.touching) S.inertia = true;
  };
  on(window, 'touchend', touchEnd);
  on(window, 'touchcancel', touchEnd);
  // 입력 중 끄기: 입력칸에서 마지막 input·keydown 뒤 TYPING_MS 안일 때만. 포커스만 있는 상태(로드 시 #amount 자동 포커스)는 출렁인다.
  const typed = (e) => {
    if (!isTyping(e.target)) return;
    S.lastTypeAt = performance.now();
    resetAll();
    if (S.raf) { cancelAnimationFrame(S.raf); stop(); }
  };
  on(window, 'input', typed);
  on(window, 'keydown', (e) => { S.touching = false; S.inertia = false; S.lastWheelAt = -1e9; typed(e); });
  on(window, 'resize', () => markStale());
  on(document, 'tabchange', () => {
    resetAll();
    if (S.raf) { cancelAnimationFrame(S.raf); stop(); }
    discover(); markStale();
    S.prevScroll = window.scrollY;
  });
}

function teardown() {
  if (!S) return;
  const s = S;
  resetAll();
  for (const el of s.units.keys()) el.removeAttribute('data-spring-unit');
  if (s.raf) cancelAnimationFrame(s.raf);
  for (const off of s.off) off();
  s.io.disconnect(); s.mo.disconnect(); if (s.ro) s.ro.disconnect();
  S = null;
  root().removeAttribute('data-spring');
}

function init() {
  if (!SPRING.enabled) return;
  const mql = window.matchMedia(REDUCED);
  if (!mql.matches) setup();
  mql.addEventListener('change', () => { if (mql.matches) teardown(); else setup(); });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.matchMedia) init();
