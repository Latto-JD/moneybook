// R4. 카테고리별 과소비 알림 - 순수 함수
import { addMonths, monthDays } from '../lib/dates.js';
import { categoryOrder } from '../lib/categories.js';
import { koCompare } from './common.js';
import { detectRecurringGroups, recurringGroupKey } from './recurring.js';

export const OVERSPENDING = {
  baselineMonths: 3,
  minBaselineMonths: 2,
  minBaseline: 10_000,
  exceededRatio: [6, 5], // 1.2
  paceRatio: [13, 10], // 1.3
  minElapsedDays: 7,
  minPaceCount: 2,
};

const round2 = (x) => Math.round(x * 100) / 100;

// month: 'YYYY-MM', today: 'YYYY-MM-DD'
// recurringKeys: R3 가 감지한 그룹 키 Set (같은 거래 데이터·같은 today 의 결과). 생략하면 여기서 R3 를 실행한다.
// pace 는 이 키에 속한 이번 달 거래(반복 거래)를 제외한 금액·건수로 판정하고, exceeded 는 반복 포함 누적으로 판정한다.
// orderOf(type, category): 정렬 동률 기준(사용자 카테고리 sortOrder). 생략하면 기본 세트 순서.
export function detectOverspending(transactions, month, today, recurringKeys, orderOf = categoryOrder) {
  const rkeys = recurringKeys ?? new Set(detectRecurringGroups(transactions, today).map((g) => g.key));
  // 카테고리 -> 월 -> 합계 (지출만, 월 라벨은 date 앞 7자)
  const totals = new Map();
  const pace = new Map(); // 카테고리 -> 이번 달 비반복 거래 {sum, count}
  const wanted = new Set([month, ...Array.from({ length: OVERSPENDING.baselineMonths }, (_, i) => addMonths(month, -(i + 1)))]);
  const todayMonth = today.slice(0, 7);
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    const m = t.date.slice(0, 7);
    if (!wanted.has(m)) continue;
    // 진행 중인 달은 오늘까지만 센다 (오늘 이후로 미리 입력한 거래는 제외)
    if (m === month && month === todayMonth && t.date > today) continue;
    if (m === month && !rkeys.has(recurringGroupKey(t))) {
      const pc = pace.get(t.category) || { sum: 0, count: 0 };
      pc.sum += t.amount;
      pc.count += 1;
      pace.set(t.category, pc);
    }
    if (!totals.has(t.category)) totals.set(t.category, new Map());
    const byMonth = totals.get(t.category);
    byMonth.set(m, (byMonth.get(m) || 0) + t.amount);
  }
  const prevMonths = Array.from({ length: OVERSPENDING.baselineMonths }, (_, i) => addMonths(month, -(i + 1)));
  const inMonth = today.slice(0, 7) === month;
  const elapsed = Number(today.slice(8, 10));
  const days = monthDays(month);
  const out = [];

  for (const [category, byMonth] of totals) {
    const current = byMonth.get(month) || 0;
    if (current <= 0) continue;
    const prior = prevMonths.map((m) => byMonth.get(m)).filter((v) => v !== undefined && v > 0);
    if (prior.length < OVERSPENDING.minBaselineMonths) continue;
    const sum = prior.reduce((a, b) => a + b, 0);
    const k = prior.length;
    const baseline = sum / k;
    if (baseline < OVERSPENDING.minBaseline) continue;

    // 정수 연산 비교: current >= baseline * 1.2  <=>  current*k*5 >= sum*6
    const [en, ed] = OVERSPENDING.exceededRatio;
    if (current * k * ed >= sum * en) {
      out.push({
        category,
        level: 'exceeded',
        currentTotal: current,
        baseline: Math.round(baseline),
        projectedTotal: null,
        ratio: round2(current / baseline),
      });
      continue;
    }
    if (inMonth && elapsed >= OVERSPENDING.minElapsedDays) {
      const [pn, pd] = OVERSPENDING.paceRatio;
      const pc = pace.get(category) || { sum: 0, count: 0 };
      // 비반복 2건 이상, projected = paceSum / elapsed * days >= baseline * 1.3
      if (pc.count >= OVERSPENDING.minPaceCount && pc.sum * days * k * pd >= sum * pn * elapsed) {
        const projected = (pc.sum / elapsed) * days;
        out.push({
          category,
          level: 'pace',
          currentTotal: current,
          baseline: Math.round(baseline),
          projectedTotal: Math.round(projected),
          ratio: round2(projected / baseline),
        });
      }
    }
  }
  out.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'exceeded' ? -1 : 1) ||
      b.ratio - a.ratio ||
      orderOf('expense', a.category) - orderOf('expense', b.category) ||
      koCompare(a.category, b.category),
  );
  return out;
}
