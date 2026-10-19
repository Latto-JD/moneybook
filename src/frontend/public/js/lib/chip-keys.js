// 카테고리 칩에서 Enter 를 눌렀을 때 폼을 저장할지 판단한다 (C29).
// 이미 선택된(aria-pressed=true) 칩에서 Enter 를 누르면 저장, 아직 선택 전이면 기본 동작(선택)이다.
// 포커스를 옮기지 않으므로 키보드/스크린리더 사용자의 위치가 바뀌지 않는다.
export function shouldSubmitOnChipEnter({ key, pressed, isComposing = false, repeat = false } = {}) {
  return key === 'Enter' && pressed === true && !isComposing && !repeat;
}
