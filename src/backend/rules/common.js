// 규칙(R1~R5) 공통 순수 함수. 거래 형태: {id, type, amount, category, memo, date, createdAt}

// 메모 정규화 키: 앞뒤 공백 제거, 연속 공백 1칸, 소문자화
export function memoKey(memo) {
  return String(memo ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// 최근 순 비교: 양수면 a 가 더 최근
export function cmpRecent(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.createdAt || '';
  const cb = b.createdAt || '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

export function latest(items) {
  return items.reduce((best, t) => (best === undefined || cmpRecent(t, best) > 0 ? t : best), undefined);
}

export const koCompare = (a, b) => String(a).localeCompare(String(b), 'ko');
