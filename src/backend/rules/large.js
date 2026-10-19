// R5. 평소보다 큰 단건 지출 - 순수 함수
import { addDays } from '../lib/dates.js';
import { median } from './common.js';

export const LARGE = { windowDays: 90, minComparisons: 5, multiple: 3, limit: 10 };

// month: 'YYYY-MM'. 비교군: 거래일 포함 90일(거래일-89 ~ 거래일) 같은 카테고리 지출, 해당 거래 제외
export function detectLargeExpenses(transactions, month) {
  const expenses = transactions.filter((t) => t.type === 'expense');
  const byCategory = new Map();
  for (const t of expenses) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category).push(t);
  }
  const out = [];
  for (const t of expenses) {
    if (t.date.slice(0, 7) !== month) continue;
    const from = addDays(t.date, -(LARGE.windowDays - 1));
    const comps = byCategory.get(t.category).filter((c) => c.id !== t.id && c.date >= from && c.date <= t.date);
    if (comps.length < LARGE.minComparisons) continue;
    const med = median(comps.map((c) => c.amount));
    if (!(t.amount > med * LARGE.multiple)) continue;
    out.push({
      transactionId: t.id,
      date: t.date,
      category: t.category,
      memo: t.memo,
      amount: t.amount,
      median: med,
      multiple: Math.round((t.amount / med) * 10) / 10,
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));
  return out.slice(0, LARGE.limit);
}
