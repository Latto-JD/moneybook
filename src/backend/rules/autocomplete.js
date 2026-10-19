// R2. 메모 자동완성 - 순수 함수
import { addDays } from '../lib/dates.js';
import { cmpRecent, koCompare, latest, memoKey } from './common.js';

export const AUTOCOMPLETE = { windowDays: 180, limit: 5, maxQueryLength: 50 };

function mostUsedCategory(items) {
  const counts = new Map();
  for (const t of items) counts.set(t.category, (counts.get(t.category) || 0) + 1);
  const max = Math.max(...counts.values());
  // 동률이면 최근 사용
  return latest(items.filter((t) => counts.get(t.category) === max)).category;
}

export function autocomplete(transactions, q, type, today) {
  const query = memoKey(q);
  if (query.length < 1) return [];
  const from = addDays(today, -(AUTOCOMPLETE.windowDays - 1));
  const groups = new Map();
  for (const t of transactions) {
    if (t.type !== type || t.date < from || t.date > today) continue;
    const key = memoKey(t.memo);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const entries = [...groups.entries()].map(([key, items]) => ({
    key,
    items,
    last: latest(items),
    starts: key.startsWith(query),
  }));
  const order = (a, b) =>
    b.items.length - a.items.length || -cmpRecent(a.last, b.last) || koCompare(a.key, b.key);
  const starts = entries.filter((e) => e.starts).sort(order);
  let result = starts;
  if (starts.length < AUTOCOMPLETE.limit) {
    const contains = entries.filter((e) => !e.starts && e.key.includes(query)).sort(order);
    result = [...starts, ...contains];
  }
  return result.slice(0, AUTOCOMPLETE.limit).map((e) => ({
    memo: e.last.memo.trim(),
    category: mostUsedCategory(e.items),
    amount: e.last.amount,
  }));
}
