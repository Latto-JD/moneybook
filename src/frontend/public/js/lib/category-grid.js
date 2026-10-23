// 카테고리 격자 보기 판단 (순수 함수). 4열 격자, 8개까지는 모두 보이고 그 이상은 접는다.
export const GRID_LIMIT = 8;

/** 접힌 부분(limit-1 번째부터)에 선택이 들어 있는지: 이 경우 자동으로 펼쳐야 선택이 보인다 */
export function selectedHidden(names, selected, limit = GRID_LIMIT) {
  const list = Array.isArray(names) ? names : [];
  if (list.length <= limit || !selected) return false;
  return list.slice(limit - 1).includes(selected);
}

/**
 * names: 활성 카테고리 이름(순서대로), selected: 선택된 이름('' 가능), expanded: 사용자가 펼쳤는지
 * 반환: { visible: string[], hiddenCount: number, toggle: null | 'more' | 'less' }
 * - limit 개 이하: 모두 보임, 버튼 없음
 * - 초과이고 접힘: 앞 limit-1 개 + '더 보기 (N)' 버튼(toggle 'more', hiddenCount N)
 * - 초과이고 펼침: 모두 + '접기' 버튼(toggle 'less')
 * - 선택이 접힌 부분에 있으면 접지 않고 모두 보인다(선택이 화면에서 사라지지 않게). 이때는 접기 버튼을 두지 않는다(눌러도 바뀌지 않으므로).
 */
export function gridView(names, selected, expanded, limit = GRID_LIMIT) {
  const list = Array.isArray(names) ? names : [];
  if (list.length <= limit) return { visible: list.slice(), hiddenCount: 0, toggle: null };
  if (selectedHidden(list, selected, limit)) return { visible: list.slice(), hiddenCount: 0, toggle: null };
  if (expanded) return { visible: list.slice(), hiddenCount: 0, toggle: 'less' };
  return { visible: list.slice(0, limit - 1), hiddenCount: list.length - (limit - 1), toggle: 'more' };
}
