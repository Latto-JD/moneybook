// R3. 반복 거래 감지 - 순수 함수
import { addDays, diffDays } from '../lib/dates.js';
import { cmpRecent, koCompare, latest, median, memoKey } from './common.js';

export const RECURRING = {
  windowDays: 400,
  amountTolerance: 0.1,
  monthly: { minCount: 3, minGap: 26, maxGap: 35 },
  weekly: { minCount: 4, minGap: 6, maxGap: 8 },
  dueSoonDays: 3,
};

function detectPeriod(dates) {
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(diffDays(dates[i], dates[i - 1]));
  for (const [period, rule] of [
    ['monthly', RECURRING.monthly],
    ['weekly', RECURRING.weekly],
  ]) {
    if (dates.length >= rule.minCount && gaps.every((g) => g >= rule.minGap && g <= rule.maxGap)) {
      return { period, gaps, rule };
    }
  }
  return null;
}

// R3 그룹 키: 메모가 있으면 (type, 메모 정규화 키), 없으면 (type, category, amount 정확히 일치)
export function recurringGroupKey(t) {
  const mk = memoKey(t.memo);
  return mk ? `${t.type}\u0000m\u0000${mk}` : `${t.type}\u0000c\u0000${t.category}\u0000${t.amount}`;
}

// 감지된 반복 항목과 그 그룹 키 목록: [{ key, item }] (R4 가 반복 거래를 제외할 때 사용)
export function detectRecurringGroups(transactions, today) {
  const from = addDays(today, -(RECURRING.windowDays - 1));
  const groups = new Map();
  for (const t of transactions) {
    if (t.date < from || t.date > today) continue;
    const key = recurringGroupKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, all] of groups) {
    // 같은 날짜의 같은 그룹 거래는 1건(가장 최근 입력)으로 계산
    const byDate = new Map();
    for (const t of all) {
      const cur = byDate.get(t.date);
      if (!cur || cmpRecent(t, cur) > 0) byDate.set(t.date, t);
    }
    const items = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const found = detectPeriod(items.map((t) => t.date));
    if (!found) continue;
    const med = median(items.map((t) => t.amount));
    // 모든 금액이 중앙값의 +-10% 이내 (정수 연산으로 부동소수 오차 방지)
    if (!items.every((t) => t.amount * 10 >= med * 9 && t.amount * 10 <= med * 11)) continue;
    const last = items[items.length - 1];
    // 비활성 제외
    if (addDays(last.date, found.rule.maxGap) < today) continue;
    const nextDate = addDays(last.date, Math.floor(median(found.gaps)));
    const item = {
      type: last.type,
      memo: last.memo.trim(),
      category: last.category,
      amount: Math.round(med),
      period: found.period,
      occurrences: items.length,
      lastDate: last.date,
      nextDate,
      dueSoon: nextDate >= today && nextDate <= addDays(today, RECURRING.dueSoonDays),
    };
    out.push({ key, item });
  }
  out.sort((a, b) =>
    a.item.nextDate < b.item.nextDate ? -1 : a.item.nextDate > b.item.nextDate ? 1 : koCompare(a.item.memo, b.item.memo),
  );
  return out;
}

export function detectRecurring(transactions, today) {
  return detectRecurringGroups(transactions, today).map((g) => g.item);
}

export { latest };
