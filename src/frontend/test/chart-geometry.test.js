import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ratioOf, formatPercent, polarToXY, arcPath, donutSegments, niceScale, barHeight, formatTick, labelStep, barLayout,
} from '../public/js/lib/chart-geometry.js';

const noBad = (v) => assert.doesNotMatch(JSON.stringify(v), /NaN|undefined|Infinity|null/);

test('ratioOf / formatPercent: 0 나눗셈 방지', () => {
  assert.equal(ratioOf(5, 0), 0);
  assert.equal(ratioOf(5, -1), 0);
  assert.equal(ratioOf(NaN, 10), 0);
  assert.equal(ratioOf(1, 4), 0.25);
  assert.equal(formatPercent(0.325), '32.5%');
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(1), '100.0%');
  assert.equal(formatPercent(NaN), '0.0%');
  assert.equal(formatPercent(Infinity), '0.0%');
  assert.equal(formatPercent(0.12345, 2), '12.35%');
});

test('polarToXY: 12시 방향 0도, 시계방향', () => {
  assert.deepEqual(polarToXY(100, 100, 50, 0), { x: 100, y: 50 });
  assert.deepEqual(polarToXY(100, 100, 50, 90), { x: 150, y: 100 });
  assert.deepEqual(polarToXY(100, 100, 50, 180), { x: 100, y: 150 });
  assert.deepEqual(polarToXY(100, 100, 50, 270), { x: 50, y: 100 });
});

test('donutSegments: 합계 0 / 빈 입력은 빈 결과', () => {
  assert.deepEqual(donutSegments([]), []);
  assert.deepEqual(donutSegments(undefined), []);
  assert.deepEqual(donutSegments([{ label: 'a', value: 0 }, { label: 'b', value: -3 }, { label: 'c', value: NaN }]), []);
});

test('donutSegments: 금액 내림차순, 각도 누적, 360도 닫힘', () => {
  const segs = donutSegments([
    { label: '교통', value: 25 }, { label: '식비', value: 50 }, { label: '쇼핑', value: 25 }, { label: '0원', value: 0 },
  ]);
  assert.deepEqual(segs.map((s) => s.label), ['식비', '교통', '쇼핑']); // 동률은 입력 순서
  assert.equal(segs[0].startAngle, 0);
  assert.equal(segs[0].endAngle, 180);
  assert.equal(segs[1].startAngle, 180);
  assert.equal(segs[1].endAngle, 270);
  assert.equal(segs[2].endAngle, 360);
  assert.equal(segs.reduce((a, s) => a + s.ratio, 0), 1);
  assert.equal(segs[0].ratio, 0.5);
  for (const s of segs) assert.ok(s.path.startsWith('M') && s.path.endsWith('Z'));
  noBad(segs.map((s) => s.path));
});

test('donutSegments: 한 조각(100%)도 유효한 경로', () => {
  const [seg] = donutSegments([{ label: '식비', value: 1000 }]);
  assert.equal(seg.ratio, 1);
  assert.equal(seg.endAngle, 360);
  assert.ok(seg.path.includes('A'));
  noBad(seg.path);
});

test('arcPath: large-arc 플래그, 빈 구간', () => {
  assert.equal(arcPath(100, 100, 90, 55, 10, 10), '');
  assert.match(arcPath(100, 100, 90, 55, 0, 200), /A90 90 0 1 1/);
  assert.match(arcPath(100, 100, 90, 55, 0, 90), /A90 90 0 0 1/);
  assert.match(arcPath(100, 100, 90, 55, 0, 90), /A55 55 0 0 0/); // 안쪽 호는 역방향
});

test('niceScale: 눈금 값', () => {
  assert.deepEqual(niceScale(0), { max: 0, step: 0, ticks: [0] });
  assert.deepEqual(niceScale(NaN), { max: 0, step: 0, ticks: [0] });
  assert.deepEqual(niceScale(-5), { max: 0, step: 0, ticks: [0] });
  const a = niceScale(1230000, 4);
  assert.equal(a.step, 500000);
  assert.deepEqual(a.ticks, [0, 500000, 1000000, 1500000]);
  assert.ok(a.max >= 1230000);
  const b = niceScale(100000, 4);
  assert.deepEqual(b.ticks, [0, 25000, 50000, 75000, 100000]);
  const c = niceScale(3, 4);
  assert.ok(c.step >= 1 && c.max >= 3);
  for (const m of [1, 7, 999, 12345, 98765432]) {
    const sc = niceScale(m);
    assert.ok(sc.max >= m && sc.ticks.length <= 8, `max ${m}`);
    noBad(sc);
  }
});

test('barHeight: 스케일 0 안전, 최소 1px, 상한', () => {
  assert.equal(barHeight(50, 100, 200), 100);
  assert.equal(barHeight(100, 100, 200), 200);
  assert.equal(barHeight(500, 100, 200), 200);
  assert.equal(barHeight(0, 100, 200), 0);
  assert.equal(barHeight(10, 0, 200), 0);
  assert.equal(barHeight(NaN, 100, 200), 0);
  assert.equal(barHeight(1, 1000000, 100), 1);
});

test('formatTick', () => {
  assert.equal(formatTick(0), '0');
  assert.equal(formatTick(5000), '5,000');
  assert.equal(formatTick(25000), '2.5만');
  assert.equal(formatTick(1500000), '150만');
  assert.equal(formatTick(100000000), '1억');
  assert.equal(formatTick(NaN), '0');
});

test('labelStep: 겹치면 격월', () => {
  assert.equal(labelStep(6, 268, 28), 1);
  assert.equal(labelStep(12, 268, 28), 2);
  assert.equal(labelStep(12, 100, 28), 4);
  assert.equal(labelStep(0, 268, 28), 1);
  assert.equal(labelStep(6, 0, 28), 1);
});

test('barLayout: 폭 안에 배치, 0 입력 안전', () => {
  assert.deepEqual(barLayout(0, 2, 100), { slot: 0, barWidth: 0, bars: [] });
  const lay = barLayout(12, 2, 268);
  assert.equal(lay.bars.length, 24);
  const last = lay.bars[23];
  assert.ok(last.x + last.width <= 268 + 0.01);
  assert.ok(lay.bars.every((b) => b.x >= 0 && b.width >= 1));
  noBad(lay);
});
