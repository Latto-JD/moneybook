// 날짜 유틸. 모든 날짜는 'YYYY-MM-DD', 월은 'YYYY-MM' 문자열이며 시간대 변환 없이 UTC 일 수로 계산한다.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

export function isValidDateStr(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isValidMonthStr(s) {
  if (typeof s !== 'string') return false;
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= MIN_YEAR && y <= MAX_YEAR;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toDayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDayNum(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return fromDayNum(toDayNum(s) + n);
}

export function diffDays(a, b) {
  return toDayNum(a) - toDayNum(b);
}

// 0(일) ~ 6(토)
export function weekday(s) {
  return new Date(toDayNum(s) * 86400000).getUTCDay();
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

export function monthIndex(month) {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function monthsBetween(from, to) {
  const out = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(addMonths(from, i - monthIndex(from)));
  return out;
}

export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  return daysInMonth(y, m);
}

export function monthStart(month) {
  return `${month}-01`;
}

// month 다음 달 1일 (배타적 상한)
export function nextMonthStart(month) {
  return `${addMonths(month, 1)}-01`;
}

const seoulFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Asia/Seoul 기준 현재 날짜 (now 를 주입해 테스트 가능)
export function todayInSeoul(now = new Date()) {
  return seoulFmt.format(now);
}
