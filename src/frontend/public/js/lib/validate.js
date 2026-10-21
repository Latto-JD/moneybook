// 입력 검증. 각 함수는 { ok, value?, message? } 를 돌려준다.
import { parseAmount } from './money.js';
import { isValidDate } from './date.js';

/** 이메일: 앞뒤 공백 제거 + 소문자. 1~254자, 공백 없음, @ 1개, 도메인에 '.'. */
export function validateEmail(input) {
  const v = String(input ?? '').trim().toLowerCase();
  if (v === '') return { ok: false, message: '이메일을 입력해 주세요' };
  if (v.length > 254 || /\s/.test(v)) return { ok: false, message: '이메일 형식이 맞지 않아요' };
  const parts = v.split('@');
  if (parts.length !== 2) return { ok: false, message: '이메일 형식이 맞지 않아요' };
  const [local, domain] = parts;
  if (!local || !/^[^.]+(\.[^.]+)+$/.test(domain)) {
    return { ok: false, message: '이메일 형식이 맞지 않아요' };
  }
  return { ok: true, value: v };
}

/** 비밀번호: 8~128자, 공백도 그대로 인정(trim 하지 않음). */
export function validatePassword(input) {
  const v = typeof input === 'string' ? input : '';
  const len = [...v].length; // 서버와 같이 코드포인트 기준
  if (len < 8) return { ok: false, message: '비밀번호는 8자 이상이어야 해요' };
  if (len > 128) return { ok: false, message: '비밀번호는 128자 이하여야 해요' };
  return { ok: true, value: v };
}

export const AMOUNT_RANGE_TEXT = '금액은 1원 이상 1억원 이하의 숫자로 입력해 주세요';

export function validateAmount(input) {
  const n = parseAmount(input);
  if (n === null) return { ok: false, message: AMOUNT_RANGE_TEXT };
  return { ok: true, value: n };
}

export function validateMemo(input) {
  const v = String(input ?? '').trim();
  if ([...v].length > 50) return { ok: false, message: '메모는 50자 이하로 입력해 주세요' };
  return { ok: true, value: v };
}

/**
 * 카테고리 검증. categories: { expense: string[], income: string[] } (GET /api/categories 의 활성 이름).
 * keep: 수정 중인 거래의 원래 { type, category }. 사용 안 함이어도 그대로 유지하는 것은 서버도 허용한다(api.md 4.3).
 */
export function validateCategory(type, category, categories, keep = null) {
  const list = type === 'income' || type === 'expense' ? (categories && categories[type]) : null;
  const kept = !!keep && keep.type === type && keep.category === category;
  if (!Array.isArray(list) || (!list.includes(category) && !kept)) {
    return { ok: false, message: '카테고리를 선택해 주세요' };
  }
  return { ok: true, value: category };
}

/** 거래 폼 전체 검증. errors는 필드별 메시지. */
export function validateTransaction({ type, amount, category, memo, date }, categories, keep = null) {
  const errors = {};
  if (type !== 'expense' && type !== 'income') errors.type = '지출/수입을 선택해 주세요';
  const a = validateAmount(amount);
  if (!a.ok) errors.amount = a.message;
  const c = validateCategory(type, category, categories, keep);
  if (!c.ok) errors.category = c.message;
  const m = validateMemo(memo);
  if (!m.ok) errors.memo = m.message;
  if (!isValidDate(date)) errors.date = '날짜 형식이 맞지 않아요';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { type, amount: a.value, category: c.value, memo: m.value, date } };
}
