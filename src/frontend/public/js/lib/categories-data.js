// 카테고리 관리용 순수 함수. 필드와 한도는 docs/api.md 3A 기준.
export const MAX_ACTIVE = 30;
export const MAX_NAME_LENGTH = 15;
export const TYPE_LABEL = { expense: '지출', income: '수입' };

/** 서버와 같은 정규화: NFC, 앞뒤 공백 제거, 연속 공백(탭·줄바꿈 포함) 1칸. */
export function normalizeCategoryName(input) {
  return String(input ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function validateCategoryName(input) {
  const v = normalizeCategoryName(input);
  const len = [...v].length; // 서버와 같이 코드포인트 기준
  if (len === 0) return { ok: false, message: '카테고리 이름을 입력해 주세요.' };
  if (len > MAX_NAME_LENGTH) return { ok: false, message: `카테고리 이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있어요.` };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, message: '이름에 쓸 수 없는 문자가 있어요.' };
  return { ok: true, value: v };
}

/** GET /api/categories 응답 -> { expense: string[], income: string[] } (활성 이름, 서버 정렬 그대로). 형식이 다르면 빈 목록. */
export function activeNamesOf(resp) {
  const pick = (k) => (resp && Array.isArray(resp[k]) ? resp[k].filter((n) => typeof n === 'string') : []);
  return { expense: pick('expense'), income: pick('income') };
}

/** items 를 유형별로 활성/사용 안 함으로 나눈다 (서버 정렬 유지). */
export function splitItems(resp, type) {
  const items = resp && Array.isArray(resp.items) ? resp.items.filter((i) => i && i.type === type) : [];
  return { active: items.filter((i) => i.active), inactive: items.filter((i) => !i.active) };
}

/** 칩에 보여 줄 "사용 안 함" 라벨 */
export const inactiveChipLabel = (name) => `${name} (사용 안 함)`;

export function renameNote(usedCount) {
  return usedCount > 0 ? `지난 기록 ${usedCount}건도 새 이름으로 바뀌어요.` : '새 이름으로 바뀌어요.';
}

export function disableConfirmText(name, usedCount) {
  const used = usedCount > 0 ? `지금까지의 기록 ${usedCount}건과 통계는 그대로 남고, ` : '통계는 그대로 남고, ';
  return `'${name}' 카테고리를 사용 안 함으로 바꿀까요? ${used}새 기록에서만 고를 수 없어요.`;
}
