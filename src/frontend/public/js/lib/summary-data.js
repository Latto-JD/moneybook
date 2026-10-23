// 요약 카드 보조 순수 함수. 금액 글자는 줄바꿈하지 않고 칸이 모자라면 라벨과 금액이 두 줄이 된다(CSS).
/** 요약 카드 aria 이름과 금액 요소 이름: "이번 달 수입 0원" 형식 */
export function amountAria(prefix, kindLabel, text) {
  return `${prefix ? `${prefix} ` : ''}${kindLabel} ${text}`;
}
