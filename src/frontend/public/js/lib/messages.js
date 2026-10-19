// 사용자에게 보여 줄 문구 (순수 함수)

/** 429 Retry-After(초) -> "N분" (최소 1분, 올림). null 이면 "잠시". */
export function waitText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '잠시';
  return `${Math.max(1, Math.ceil(seconds / 60))}분`;
}

/** 로그인/가입 오류 -> 문구. err: { status, code, message, retryAfter } */
export function authErrorMessage(err) {
  if (!err) return '요청을 처리하지 못했어요.';
  switch (err.code) {
    case 'INVALID_CREDENTIALS': return '이메일 또는 비밀번호가 맞지 않아요';
    case 'EMAIL_TAKEN': return '이미 가입된 이메일이에요';
    case 'SIGNUP_DISABLED': return '지금은 새로 가입할 수 없어요. 관리자에게 문의해 주세요';
    case 'TOO_MANY_ATTEMPTS': return `시도가 너무 많아요. ${waitText(err.retryAfter)} 후 다시 시도해 주세요`;
    default: break;
  }
  if (err.status === 429) return `시도가 너무 많아요. ${waitText(err.retryAfter)} 후 다시 시도해 주세요`;
  return err.message || '요청을 처리하지 못했어요.';
}

export const EXPIRED_TEXT = '로그인이 만료되었어요. 다시 로그인해 주세요';
