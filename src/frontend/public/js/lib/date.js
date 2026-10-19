// 날짜 유틸. 모든 날짜는 'YYYY-MM-DD', 월은 'YYYY-MM' 문자열.
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 브라우저 로컬 시간 기준 오늘. now는 테스트용 주입. */
export function todayLocal(now = new Date()) {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function daysInMonth(ym) {
  if (!isValidMonth(ym)) return 0;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 실존하는 YYYY-MM-DD 인지 (2026-02-30, 20261019 모두 false). */
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ym = s.slice(0, 7);
  if (!isValidMonth(ym)) return false;
  const d = Number(s.slice(8, 10));
  return d >= 1 && d <= daysInMonth(ym);
}

/** 월 이동: shiftMonth('2026-01', -1) -> '2025-12'. 잘못된 입력이면 null. */
export function shiftMonth(ym, delta) {
  if (!isValidMonth(ym) || !Number.isInteger(delta)) return null;
  const idx = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + delta;
  const y = Math.floor(idx / 12);
  if (y < 1 || y > 9999) return null;
  return `${pad(y, 4)}-${pad(idx - y * 12 + 1)}`;
}

/** 월의 첫날/마지막날. */
export function monthRange(ym) {
  if (!isValidMonth(ym)) return null;
  return { start: `${ym}-01`, end: `${ym}-${pad(daysInMonth(ym))}` };
}

/** from~to 모든 달(오래된 순). 잘못되었거나 from > to 면 []. */
export function monthsBetween(from, to) {
  if (!isValidMonth(from) || !isValidMonth(to) || from > to) return [];
  const out = [];
  for (let m = from; m !== null && m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** 기준 월 포함 최근 n개월 범위: { from, to }. */
export function trailingRange(ym, n) {
  if (!isValidMonth(ym) || !Number.isInteger(n) || n < 1) return null;
  return { from: shiftMonth(ym, -(n - 1)), to: ym };
}

/** '2026-10' -> '2026년 10월' */
export function monthTitle(ym) {
  if (!isValidMonth(ym)) return '';
  return `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
}

/** '2026-05' -> '5월' */
export function monthShort(ym) {
  if (!isValidMonth(ym)) return '';
  return `${Number(ym.slice(5, 7))}월`;
}

/** '2026-10-19' -> '10월 19일 (월)'. 오늘이면 '오늘'. */
export function dayLabel(dateStr, today) {
  if (!isValidDate(dateStr)) return '';
  if (dateStr === today) return '오늘';
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${wd})`;
}
