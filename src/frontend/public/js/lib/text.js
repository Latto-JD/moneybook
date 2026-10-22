// 이름류 문자열 공통 정리 (사용자 이름, 카테고리 이름). 길이 한도와 오류 문구는 호출하는 쪽이 정한다.
// 서버 src/backend/lib/text.js 와 같은 규칙이어야 한다 (docs/api.md 2장·3A.1).

// C0 제어문자·DEL (탭·줄바꿈은 공백으로 취급하므로 제외)
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// 방향 제어 문자: U+200E/F, U+202A-E, U+2066-9
const BIDI_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
// 폭 없는 문자: 제거한다. ZWNJ/ZWJ(U+200C/D)는 이모지 조합에 쓰이므로 건드리지 않는다.
const ZERO_WIDTH_RE = /[\u200b\u2060\ufeff]/g;

// 반환: { text } | { forbidden: true } (거부할 문자가 있음). text 는 비어 있을 수 있다.
export function cleanText(raw) {
  if (CONTROL_RE.test(raw) || BIDI_RE.test(raw)) return { forbidden: true };
  return { text: raw.normalize('NFC').replace(ZERO_WIDTH_RE, '').trim().replace(/\s+/g, ' ') };
}

// 도넛 차트 묶음 라벨 "그 외 N개" 와 같은 모양의 이름 (카테고리 이름으로 새로 쓸 수 없다)
export const isReservedCategoryName = (name) => /^그 외 \d+개$/.test(name);
export const RESERVED_NAME_ERROR = "'그 외 N개'는 차트 묶음 이름이라 쓸 수 없어요.";
