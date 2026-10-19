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

export function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  const len = [...password].length;
  return len >= 8 && len <= 128;
}
