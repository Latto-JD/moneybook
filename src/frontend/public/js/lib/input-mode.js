// 마지막 포인터 입력이 터치(또는 펜)였는지 판정 (순수 함수). 터치면 저장 뒤 숫자 패드를 내린다.
/** PointerEvent.pointerType -> 터치 모드인지. 'mouse'·빈 값·알 수 없는 값은 false */
export function isTouchType(pointerType) {
  return pointerType === 'touch' || pointerType === 'pen';
}
