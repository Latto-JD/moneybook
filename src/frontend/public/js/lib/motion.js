// 대시보드 카드 움직임 판단 (순수 함수) + 적용 보조. 움직임 자체는 style.css 의 CSS 애니메이션이 한다.
// 이유(reason): 'month' 달 변경 | 'tab' 탭 진입 | 'range' 6/12개월 | 'catview' 지출/수입 | 'catchange' 카테고리 목록 변경 | 'chip' 추이 칩 선택
// 카드(card): 'kpi' | 'donut'(막대 포함) | 'monthly' | 'trend' | 'insights'
const NONE = { fade: false, stagger: false };
const FADE = { fade: true, stagger: false };
const FADE_STAGGER = { fade: true, stagger: true };

const TABLE = {
  month: { kpi: FADE, donut: FADE_STAGGER, monthly: FADE, trend: FADE, insights: FADE },
  tab: { kpi: FADE, donut: FADE_STAGGER, monthly: FADE, trend: FADE, insights: FADE },
  range: { monthly: FADE, trend: FADE }, // 요약 카드는 같은 값이라 깜빡이지 않게 없음
  catview: { donut: FADE_STAGGER, trend: FADE },
  // catchange(카테고리 목록 변경), chip(추이 칩 선택)은 어느 카드도 움직이지 않는다
};

/** 이 이유로 이 카드를 다시 그릴 때: { fade, stagger } (표에 없으면 둘 다 false) */
export function motionFor(reason, card) {
  const m = TABLE[reason] && TABLE[reason][card];
  return m ? { ...m } : { ...NONE };
}

/** data-motion 값: 'fade' | 'fade grow' | '' (stagger 는 막대 자라기 'grow') */
export function motionTokens({ fade = false, stagger = false } = {}) {
  return [fade && 'fade', stagger && 'grow'].filter(Boolean).join(' ');
}

/** 그리기 직전에 부른다: 새로 그려지는 자식만 재생되고, 다음 그리기에서 값이 없으면 재생되지 않는다 */
export function applyMotion(el, m) {
  const t = motionTokens(m);
  if (t) el.setAttribute('data-motion', t);
  else el.removeAttribute('data-motion');
}
