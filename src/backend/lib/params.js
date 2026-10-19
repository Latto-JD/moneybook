// 쿼리 파라미터 검증 헬퍼. 실패 시 ApiError(400 VALIDATION_ERROR).
import { ApiError } from '../http.js';
import { TYPES } from './categories.js';
import { isValidDateStr, isValidMonthStr, monthIndex, todayInSeoul } from './dates.js';

const bad = (field, message) => new ApiError(400, 'VALIDATION_ERROR', message, { fields: { [field]: message } });

export function requireMonth(value, field = 'month') {
  if (typeof value !== 'string' || !isValidMonthStr(value)) {
    throw bad(field, `${field} 는 YYYY-MM 형식의 실제 월이어야 해요.`);
  }
  return value;
}

export function parseType(value, fallback = 'expense') {
  if (value === undefined) return fallback;
  if (!TYPES.includes(value)) throw bad('type', 'type 은 expense 또는 income 이어야 해요.');
  return value;
}

// today 가 없으면 Asia/Seoul 현재 날짜. now 는 () => Date
export function parseToday(value, now = () => new Date()) {
  if (value === undefined || value === '') return todayInSeoul(now());
  if (!isValidDateStr(value)) throw bad('today', 'today 는 YYYY-MM-DD 형식의 실제 날짜여야 해요.');
  return value;
}

export const MAX_RANGE_MONTHS = 24;

export function parseRange(query) {
  const from = requireMonth(query.from, 'from');
  const to = requireMonth(query.to, 'to');
  const span = monthIndex(to) - monthIndex(from) + 1;
  if (span < 1) throw bad('to', 'from 은 to 보다 늦을 수 없어요.');
  if (span > MAX_RANGE_MONTHS) throw bad('to', `기간은 최대 ${MAX_RANGE_MONTHS}개월까지 조회할 수 있어요.`);
  return { from, to };
}
