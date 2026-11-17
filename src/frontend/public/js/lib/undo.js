// 저장·수정 되돌리기 판단 (순수 함수). 요청은 기존 DELETE/PUT 을 쓴다 (docs/api.md 4장).

/** 거래 객체에서 PUT 본문 필드만 */
export function txBody(tx) {
  return { type: tx.type, amount: tx.amount, category: tx.category, memo: tx.memo || '', date: tx.date };
}

/**
 * 되돌리기 계획. 되돌릴 수 없으면 null.
 * kind: 'create' | 'update' | 'delete'
 * delete: before = 지운 거래 전체 값, after 는 쓰지 않는다. 다시 만드는 POST 라 활성 카테고리 거래만 호출한다 (호출하는 쪽이 거른다)
 * before: 수정 전 거래 전체 값 (update 일 때만)
 * after: 저장 응답의 거래 ({ id, type, category, ... })
 * legacyBefore: 수정 전 카테고리가 사용 안 함이었는지 (서버가 사용 안 함 카테고리로 되돌리는 PUT 을 400 으로 막는다)
 * 반환: { method:'DELETE'|'PUT'|'POST', id, body, month:null|'YYYY-MM' } (month: 되돌린 뒤 보여 줄 달, 생성 되돌리기는 null. POST 는 id 가 null)
 */
export function undoPlan(kind, before, after, legacyBefore = false) {
  if (kind === 'delete') {
    if (!before || typeof before.date !== 'string') return null;
    return { method: 'POST', id: null, body: txBody(before), month: before.date.slice(0, 7) };
  }
  if (!after || after.id === undefined || after.id === null) return null;
  if (kind === 'create') return { method: 'DELETE', id: after.id, body: null, month: null };
  if (kind !== 'update' || !before || typeof before.date !== 'string') return null;
  if (legacyBefore && (before.type !== after.type || before.category !== after.category)) return null;
  return { method: 'PUT', id: after.id, body: txBody(before), month: before.date.slice(0, 7) };
}

/**
 * 토스트를 다른 부모로 옮긴 뒤 타이머를 멈춰 둘지: 옮기기 전의 멈춤 상태는 버리고(옮기면 pointerleave 가 오지 않는다),
 * 지금 실제로 포인터가 위에 있거나 포커스가 안에 있을 때만 멈춘다.
 */
export function pausedAfterMove({ hover = false, focusInside = false } = {}) {
  return Boolean(hover || focusInside);
}

/** 삭제 되돌리기(POST) 실패 문구: 거래는 이미 지워진 상태라 다시 입력하도록 안내 */
export const RESTORE_FAIL_TEXT = '되살리지 못했어요. 다시 입력해 주세요';

/** 되돌리기 실패 문구: method 가 'POST'(삭제 되돌리기)면 다시 입력 안내, 404 는 이미 지워진 기록(수정 되돌리기), 그 밖은 직접 고치도록 안내 */
export function undoFailText(err, method) {
  if (method === 'POST') return RESTORE_FAIL_TEXT;
  if (err && err.status === 404) return '이미 삭제된 기록이라 되돌리지 못했어요';
  return '되돌리지 못했어요. 목록에서 직접 고쳐 주세요.';
}
