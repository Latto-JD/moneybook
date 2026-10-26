// 스크롤 출렁임 물리 (순수 함수). DOM 은 건드리지 않는다. 구동은 scroll-spring.js 가 한다.
// 유닛 상태 { y, v }: y 는 레이아웃 위치에서의 시각 변위(px, 0 이 제자리), v 는 속도(px/s).

/** 모든 조정값은 여기 한 곳. enabled 가 false 면 scroll-spring.js 는 리스너를 하나도 붙이지 않는다. */
export const SPRING = {
  enabled: true,
  k: 170, // 강성 (/s²), 고유 진동수 약 2.1Hz
  c: 14, // 감쇠 (/s), ζ ≈ 0.54 -> 한 번 약 13% 되튐
  R: 500, // 끌림 거리 (px): 기준점에서 이만큼 떨어지면 스크롤 변화량을 그대로 받음
  YMAX_CARD: 20, // 카드 변위 상한 (px)
  YMAX_ROW: 12, // 행 변위 상한 (px)
  VREF: 1200, // 세로 늘어남이 최대가 되는 속도 (px/s)
  SMAX: 0.015, // 최대 세로 늘어남 (0 이면 scale 을 쓰지 않음)
  STEP: 1 / 120, // 고정 시간 간격 (s)
  DT_MAX: 0.05, // 한 프레임 간격 상한 (s): 백그라운드 복귀 때 폭주 방지
  Y_EPS: 0.15, // 정지 판정 변위 (px)
  V_EPS: 5, // 정지 판정 속도 (px/s)
  HARD_STOP_MS: 1200, // 이 시간 안에 못 멈추면 강제 0
  MAX_ACTIVE: 40, // 한 번에 출렁이는 유닛 상한
  SLOW_FRAME_MS: 25, // 제스처 중 프레임 간격 중앙값이 이보다 크면 느린 기기
  SLOW_GESTURES: 2, // 연속 몇 번 느리면 그 세션에서 끄는지
  TYPING_MS: 800, // 입력칸에서 마지막 input·keydown 뒤 이 시간 안이면 출렁임을 멈춤 (포커스만으로는 멈추지 않음)
  TOUCH_GAP_MS: 100, // 손을 뗀 뒤 스크롤 이벤트가 이만큼 끊기면 관성 끝
  WHEEL_GAP_MS: 150, // 마지막 wheel 뒤 제스처 유지 시간
};

export function ymaxFor(kind) {
  return kind === 'row' ? SPRING.YMAX_ROW : SPRING.YMAX_CARD;
}

/** scrollY 를 [0, max] 로 자른다 (iOS 고무줄·당겨서 새로고침 구간에서 변화량이 0 이 되게) */
export function clampScroll(y, max) {
  return Math.min(Math.max(y, 0), Math.max(max, 0));
}

/** 한 프레임의 스크롤 변화량 (아래로 스크롤하면 양수). 범위 밖 위치는 먼저 잘라서 계산한다. */
export function scrollDelta(prev, now, max) {
  return clampScroll(now, max) - clampScroll(prev, max);
}

/** 기준점과의 거리 d 에 따른 끌림 비율 0..1 (0 이면 손가락에 붙어 움직이고 1 이면 가장 늦게 따라옴) */
export function dragRatio(d, R = SPRING.R) {
  return Math.min(Math.abs(d) / R, 1);
}

export function clampY(y, ymax) {
  return Math.min(Math.max(y, -ymax), ymax);
}

/** 끌림 주입: y += Δ × r, 상한을 넘으면 자르고 속도는 0 */
export function inject(state, delta, d, ymax) {
  const y = state.y + delta * dragRatio(d);
  if (Math.abs(y) > ymax) return { y: clampY(y, ymax), v: 0 };
  return { y, v: state.v };
}

/** 스프링 복원 dt 초 진행 (반-암시적 오일러, 간격은 STEP 이하로 나눔, dt 는 DT_MAX 로 자름) */
export function advance(state, dt) {
  const t = Math.min(Math.max(dt, 0), SPRING.DT_MAX);
  if (t === 0) return { y: state.y, v: state.v };
  const n = Math.ceil(t / SPRING.STEP - 1e-9);
  const h = t / n;
  let { y, v } = state;
  for (let i = 0; i < n; i++) {
    v += (-SPRING.k * y - SPRING.c * v) * h;
    y += v * h;
  }
  return { y, v };
}

export function isSettled(state) {
  return Math.abs(state.y) < SPRING.Y_EPS && Math.abs(state.v) < SPRING.V_EPS;
}

/** 속도에 따른 세로 늘어남 배율 (1 이상). SMAX 가 0 이면 항상 1 */
export function scaleYFor(v) {
  if (!(SPRING.SMAX > 0)) return 1;
  return 1 + Math.min(Math.abs(v) / SPRING.VREF, 1) * SPRING.SMAX;
}

/** 인라인 transform 문자열. 늘어남이 없으면 scaleY 를 쓰지 않는다. */
export function transformFor(state) {
  const s = scaleYFor(state.v);
  const t = `translate3d(0, ${state.y.toFixed(2)}px, 0)`;
  return s > 1.0001 ? `${t} scaleY(${s.toFixed(4)})` : t;
}

/** 값 배열의 중앙값 (빈 배열이면 0) */
export function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 유닛 중심(뷰포트 좌표)이 기준점보다 아래면 늘어남 기준을 위쪽 가장자리로 */
export function originFor(centerY, refY) {
  return centerY >= refY ? 'top' : 'bottom';
}

/** 최근 입력(input·keydown) 여부: lastTypeAt 뒤 TYPING_MS 안이면 참 */
export function isRecentTyping(now, lastTypeAt) {
  return now - lastTypeAt >= 0 && now - lastTypeAt < SPRING.TYPING_MS;
}
