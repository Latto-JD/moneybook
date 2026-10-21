// 디자인 적용 순수 함수 단위 테스트: 색·무늬 번호, 균형 막대, 빠른 금액, 부호 표기, 한도 문구
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableVizMap, vizOf, assignDonutViz } from '../public/js/lib/viz.js';
import { balanceBars } from '../public/js/lib/dashboard-data.js';
import { addToAmount, formatSignedWon, formatBalanceWon, MAX_AMOUNT } from '../public/js/lib/money.js';
import { limitText } from '../public/js/lib/categories-data.js';

const cat = (name, sortOrder, type = 'expense') => ({ name, sortOrder, type, active: true });

test('stableVizMap: 유형별 sortOrder 순 1~8번째 = 1..8, 9번째부터 고정 번호 없음', () => {
  const items = [...Array.from({ length: 10 }, (_, i) => cat(`c${i + 1}`, i + 1)), cat('급여', 1, 'income')];
  const map = stableVizMap(items, 'expense');
  assert.equal(map.size, 8);
  assert.equal(map.get('c1'), 1);
  assert.equal(map.get('c8'), 8);
  assert.equal(vizOf(map, 'c9'), 'none');
  assert.equal(vizOf(map, '모르는 이름'), 'none');
  assert.equal(stableVizMap(items, 'income').get('급여'), 1);
  assert.equal(stableVizMap(undefined, 'expense').size, 0);
});

test('stableVizMap: 사용 안 함도 순위에 넣어 다른 카테고리 번호가 밀리지 않는다', () => {
  const items = [cat('a', 1), { ...cat('b', 2), active: false }, cat('c', 3)];
  assert.equal(stableVizMap(items, 'expense').get('c'), 3);
});

test('assignDonutViz: 고정 번호 우선, 겹치거나 없으면 남은 가장 작은 번호, 묶음은 other, 모두 다름', () => {
  const map = new Map([['a', 3], ['b', 3], ['c', 1]]);
  const slices = [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'z' }, { label: '그 외 2개', members: [{}, {}] }];
  const out = assignDonutViz(slices, map);
  assert.deepEqual(out, [3, 2, 1, 4, 'other']);
  assert.equal(new Set(out).size, out.length);
});

test('balanceBars: 큰 쪽 100%, 작은 쪽 비율, 둘 다 0 이면 0/0', () => {
  assert.deepEqual(balanceBars(900000, 400000), { income: 100, expense: 44.4 });
  assert.deepEqual(balanceBars(100, 100), { income: 100, expense: 100 });
  assert.deepEqual(balanceBars(0, 0), { income: 0, expense: 0 });
  assert.deepEqual(balanceBars(NaN, undefined), { income: 0, expense: 0 });
  assert.deepEqual(balanceBars(0, 500), { income: 0, expense: 100 });
});

test('addToAmount: 더하기, 빈 값은 0 에서 시작, 상한에서 멈춤', () => {
  assert.deepEqual(addToAmount('', 10000), { value: 10000, capped: false });
  assert.deepEqual(addToAmount('10,000', 1000), { value: 11000, capped: false });
  assert.deepEqual(addToAmount('11,000', 50000), { value: 61000, capped: false });
  assert.deepEqual(addToAmount('99,999,000', 5000), { value: MAX_AMOUNT, capped: true });
});

test('부호 표기: 지출 U+2212, 수입 +, 남은 돈 음수는 U+2212', () => {
  assert.equal(formatSignedWon('expense', 12500), '−12,500원');
  assert.equal(formatSignedWon('income', 12500), '+12,500원');
  assert.equal(formatBalanceWon(-300), '−300원');
  assert.equal(formatBalanceWon(300), '300원');
});

test('limitText: N/30 형식, 가득 차면 이유를 알린다', () => {
  assert.match(limitText(9), /^9\/30 · /);
  assert.match(limitText(30), /^30\/30 · 더 추가할 수 없어요/);
});
