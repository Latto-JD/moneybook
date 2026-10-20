// 차트 기하 계산 (DOM 비의존 순수 함수). 각도는 12시 방향 = 0도, 시계방향 증가.
import { formatNumber } from './money.js';

const r2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 0 나눗셈 안전 비율. 분모가 0/비정상이면 0. */
export function ratioOf(part, total) {
  if (!isNum(part) || !isNum(total) || total <= 0) return 0;
  return part / total;
}

/** 0.325 -> "32.5%". 비정상 값은 "0.0%". */
export function formatPercent(ratio, digits = 1) {
  const v = isNum(ratio) ? ratio * 100 : 0;
  return `${v.toFixed(digits)}%`;
}

export function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: r2(cx + r * Math.sin(rad)), y: r2(cy - r * Math.cos(rad)) };
}

/** 도넛 조각 경로 (바깥 호 -> 안쪽 호 역방향). 360도에 가까우면 반원 2개로 그린다. */
export function arcPath(cx, cy, outerR, innerR, startDeg, endDeg) {
  const sweep = endDeg - startDeg;
  if (!(sweep > 0)) return '';
  if (sweep >= 359.999) {
    const ring = (r, dir) => {
      const top = polarToXY(cx, cy, r, 0);
      const bottom = polarToXY(cx, cy, r, 180);
      return `M${top.x} ${top.y}A${r} ${r} 0 1 ${dir} ${bottom.x} ${bottom.y}A${r} ${r} 0 1 ${dir} ${top.x} ${top.y}Z`;
    };
    return ring(outerR, 1) + (innerR > 0 ? ring(innerR, 0) : '');
  }
  const large = sweep > 180 ? 1 : 0;
  const o1 = polarToXY(cx, cy, outerR, startDeg);
  const o2 = polarToXY(cx, cy, outerR, endDeg);
  if (innerR <= 0) {
    return `M${cx} ${cy}L${o1.x} ${o1.y}A${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y}Z`;
  }
  const i1 = polarToXY(cx, cy, innerR, startDeg);
  const i2 = polarToXY(cx, cy, innerR, endDeg);
  return `M${o1.x} ${o1.y}A${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y}L${i2.x} ${i2.y}A${innerR} ${innerR} 0 ${large} 0 ${i1.x} ${i1.y}Z`;
}

/**
 * 도넛 조각 계산. items: [{label, value}]. value<=0 / 비정상 값은 제외,
 * 금액 내림차순(동률은 입력 순서) 정렬, 12시부터 시계방향. 합계 0이면 [].
 * pinLast 가 true 인 항목("그 외" 묶음)은 금액과 무관하게 맨 뒤에 둔다.
 */
export function donutSegments(items, { cx = 100, cy = 100, outerR = 90, innerR = 55 } = {}) {
  const list = (Array.isArray(items) ? items : [])
    .map((it, i) => ({ ...it, _i: i }))
    .filter((it) => isNum(it.value) && it.value > 0);
  const total = list.reduce((s, it) => s + it.value, 0);
  if (total <= 0) return [];
  list.sort((a, b) => (a.pinLast ? 1 : 0) - (b.pinLast ? 1 : 0) || b.value - a.value || a._i - b._i);
  let angle = 0;
  return list.map((it, idx) => {
    const ratio = it.value / total;
    const start = angle;
    // 마지막 조각은 누적 오차 없이 360도로 닫는다
    const end = idx === list.length - 1 ? 360 : angle + ratio * 360;
    angle = end;
    const { _i, ...rest } = it;
    return {
      ...rest,
      ratio,
      startAngle: start,
      endAngle: end,
      midAngle: (start + end) / 2,
      path: arcPath(cx, cy, outerR, innerR, start, end),
    };
  });
}

/** 눈금 후보 간격: 1, 2, 2.5, 5, 10 x 10^k (정수 단위 유지). */
export function niceScale(maxValue, targetTicks = 4) {
  if (!isNum(maxValue) || maxValue <= 0) return { max: 0, step: 0, ticks: [0] };
  const raw = maxValue / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  step = Math.max(1, step);
  const count = Math.ceil(maxValue / step - 1e-9);
  const ticks = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round(i * step * 100) / 100);
  return { max: ticks[ticks.length - 1], step, ticks };
}

/** 막대 높이(px). 값이 양수면 최소 1px, 스케일이 0이면 0. */
export function barHeight(value, scaleMax, plotHeight) {
  if (!isNum(value) || !isNum(scaleMax) || !isNum(plotHeight) || value <= 0 || scaleMax <= 0 || plotHeight <= 0) return 0;
  const h = (Math.min(value, scaleMax) / scaleMax) * plotHeight;
  return Math.max(1, r2(h));
}

/** 축 눈금 라벨: 0, 5000, 2.5만, 150만, 1.2억 */
export function formatTick(value) {
  if (!isNum(value)) return '0';
  const a = Math.abs(value);
  const trim = (n) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');
  if (a >= 100000000) return `${trim(value / 100000000)}억`;
  if (a >= 10000) return `${trim(value / 10000)}만`;
  return formatNumber(value);
}

/** x축 레이블 간격: 겹치면 2칸(격월), 더 좁으면 3칸... */
export function labelStep(count, availableWidth, minLabelWidth) {
  if (!isNum(count) || !isNum(availableWidth) || !isNum(minLabelWidth) || count <= 0 || availableWidth <= 0) return 1;
  const slot = availableWidth / count;
  return Math.max(1, Math.ceil(minLabelWidth / slot));
}

/**
 * 막대 차트 레이아웃: groups 개의 그룹, 그룹당 series 개의 막대.
 * 반환: 각 막대의 x(좌측), width. plot 폭 안에서 균등 배치.
 */
export function barLayout(groups, series, plotWidth, { groupGap = 0.3, barGap = 1 } = {}) {
  if (!(groups > 0) || !(series > 0) || !(plotWidth > 0)) return { slot: 0, barWidth: 0, bars: [] };
  const slot = plotWidth / groups;
  const inner = slot * (1 - groupGap);
  const barWidth = Math.max(1, r2((inner - barGap * (series - 1)) / series));
  const used = barWidth * series + barGap * (series - 1);
  const bars = [];
  for (let g = 0; g < groups; g++) {
    const gx = g * slot + (slot - used) / 2;
    for (let s = 0; s < series; s++) bars.push({ group: g, series: s, x: r2(gx + s * (barWidth + barGap)), width: barWidth });
  }
  return { slot: r2(slot), barWidth, bars };
}
