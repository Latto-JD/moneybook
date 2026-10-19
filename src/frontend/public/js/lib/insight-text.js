// 인사이트(R3/R4/R5) -> 한 줄 문장. 순수 함수. 필드는 docs/api.md 6.3 기준.
import { formatWon } from './money.js';

export const INSIGHT_EMPTY_TEXT = '아직 알려드릴 내용이 없어요. 기록이 쌓이면 반복 지출과 평소보다 많이 쓴 곳을 알려드려요.';

const mdText = (dateStr) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(dateStr));
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : '';
};

/** R4. level exceeded | pace. 반환: { icon, label, text } (icon 은 장식, label 은 텍스트 구분) */
export function overspendingLine(o) {
  const pct = Math.round(((o.ratio || 0) - 1) * 100);
  if (o.level === 'exceeded') {
    return {
      icon: '⚠', label: '초과',
      text: `${o.category}: 이번 달 ${formatWon(o.currentTotal)}으로 평소 월 평균 ${formatWon(o.baseline)}보다 ${Math.max(pct, 0)}% 더 썼어요`,
    };
  }
  return {
    icon: '⏳', label: '페이스 주의',
    text: `${o.category}: 지금 속도면 이번 달 ${formatWon(o.projectedTotal ?? 0)} 예상이에요 (평소 월 평균 ${formatWon(o.baseline)})`,
  };
}

/** R3. */
export function recurringLine(r) {
  const period = r.period === 'weekly' ? '매주' : '매월';
  const memo = r.memo || r.category;
  const kind = r.type === 'income' ? '수입' : '지출';
  const next = mdText(r.nextDate);
  const text = `${memo} ${formatWon(r.amount)} ${period} 반복 ${kind}${next ? ` · 다음 예정 ${next}` : ''}`;
  return r.dueSoon
    ? { icon: '⏰', label: '곧 예정', text, strong: true }
    : { icon: '↻', label: '반복', text, strong: false };
}

/** R5. */
export function largeExpenseLine(l) {
  const memo = l.memo ? `${l.memo} ` : '';
  return {
    icon: '▲', label: '큰 지출',
    text: `${mdText(l.date)} ${memo}${formatWon(l.amount)} (${l.category}) - 평소 중앙값 ${formatWon(l.median)}의 ${Number(l.multiple).toFixed(1)}배`,
  };
}

/** 응답 전체 -> 섹션 목록. 모두 비면 []. */
export function buildInsightSections(data) {
  const d = data || {};
  const sections = [];
  const over = Array.isArray(d.overspending) ? d.overspending : [];
  const rec = Array.isArray(d.recurring) ? d.recurring : [];
  const big = Array.isArray(d.largeExpenses) ? d.largeExpenses : [];
  if (over.length) sections.push({ key: 'overspending', title: '과소비 알림', lines: over.map(overspendingLine) });
  if (rec.length) sections.push({ key: 'recurring', title: '반복 거래', lines: rec.map(recurringLine) });
  if (big.length) sections.push({ key: 'large', title: '평소보다 큰 지출', lines: big.map(largeExpenseLine) });
  return sections;
}
