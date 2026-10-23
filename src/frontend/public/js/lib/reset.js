// 입력 초기화 아이콘 표시 조건 (순수 함수). 카테고리 선택은 보지 않는다(저장 뒤에도 유지되므로).
export function shouldShowReset({ editing, amount, memo, type, date, today }) {
  if (editing) return false;
  return amount !== '' || memo !== '' || type !== 'expense' || date !== today;
}
