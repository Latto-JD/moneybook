// R1. 빠른 입력 제안 (자주 쓰는 항목) - DB 와 무관한 순수 함수
import { addDays, weekday } from '../lib/dates.js';
import { cmpRecent, koCompare, latest, memoKey } from './common.js';

export const QUICK = { windowDays: 90, minCount: 3, weekdayWindowDays: 56, weekdayMin: 2, limit: 5 };

function representativeAmount(items) {
  const counts = new Map();
  for (const t of items) counts.set(t.amount, (counts.get(t.amount) || 0) + 1);
  const max = Math.max(...counts.values());
  // 최빈값이 여러 개면 그중 가장 최근 거래의 금액
  const modes = items.filter((t) => counts.get(t.amount) === max);
  return latest(modes).amount;
}

// activeNames: 활성 카테고리 이름 Set. 있으면 그 밖의 카테고리(사용 안 함, 목록에 없음) 그룹은 제안하지 않는다.
export function quickSuggestions(transactions, type, today, activeNames) {
  const from = addDays(today, -(QUICK.windowDays - 1));
  const weekdayFrom = addDays(today, -(QUICK.weekdayWindowDays - 1));
  const todayWeekday = weekday(today);
  const groups = new Map();
  for (const t of transactions) {
    if (t.type !== type || t.date < from || t.date > today) continue;
    if (!String(t.memo ?? '').trim()) continue;
    const key = `${t.category}\u0000${memoKey(t.memo)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const items of groups.values()) {
    if (items.length < QUICK.minCount) continue;
    if (activeNames && !activeNames.has(items[0].category)) continue;
    const last = latest(items);
    const weekdayCount = items.filter((t) => t.date >= weekdayFrom && weekday(t.date) === todayWeekday).length;
    out.push({
      memo: last.memo.trim(),
      category: last.category,
      amount: representativeAmount(items),
      count: items.length,
      lastDate: last.date,
      weekdayMatch: weekdayCount >= QUICK.weekdayMin,
    });
  }
  out.sort(
    (a, b) =>
      Number(b.weekdayMatch) - Number(a.weekdayMatch) ||
      b.count - a.count ||
      (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0) ||
      koCompare(a.memo, b.memo),
  );
  return out.slice(0, QUICK.limit);
}

export { cmpRecent };
