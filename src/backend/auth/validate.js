export function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

// 단순 형식 검사: 공백 없음, @ 1개, 로컬/도메인 비어있지 않음, 도메인에 '.' 포함(양끝/연속 불가)
export function isValidEmail(email) {
  if (typeof email !== 'string' || email.length < 3 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return true;
}

export const NAME_MAX = 20;

// 이름 정규화: NFC, 앞뒤 공백 제거, 연속 공백(탭·줄바꿈 포함) 1칸. 문제가 있으면 { error } 를 돌려준다.
export function normalizeName(raw) {
  if (typeof raw !== 'string') return { error: '이름을 입력해 주세요.' };
  // 제어문자는 공백 정규화 전에 검사한다 (탭·줄바꿈은 공백으로 취급하므로 제외)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return { error: '이름에 쓸 수 없는 문자가 있어요.' };
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const len = [...name].length;
  if (len < 1 || len > NAME_MAX) return { error: `이름은 1자 이상 ${NAME_MAX}자 이하여야 해요.` };
  return { name };
}

export function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  const len = [...password].length;
  return len >= 8 && len <= 128;
}
