import { cleanText } from '../lib/text.js';

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

// 이름 정규화: 공통 정리(lib/text.js) 후 길이 검사. 문제가 있으면 { error } 를 돌려준다.
export function normalizeName(raw) {
  if (typeof raw !== 'string') return { error: '이름을 입력해 주세요.' };
  const c = cleanText(raw);
  if (c.forbidden) return { error: '이름에 쓸 수 없는 문자가 있어요.' };
  const len = [...c.text].length;
  if (len < 1 || len > NAME_MAX) return { error: `이름은 1자 이상 ${NAME_MAX}자 이하여야 해요.` };
  return { name: c.text };
}

export function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  const len = [...password].length;
  return len >= 8 && len <= 128;
}
