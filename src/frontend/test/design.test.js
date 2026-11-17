// 디자인 적용 순수 함수 단위 테스트: 색·무늬 번호, 균형 막대, 빠른 금액, 부호 표기, 한도 문구
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableVizMap, vizOf, assignDonutViz, vizName, VIZ_NAMES, VIZ_COUNT } from '../public/js/lib/viz.js';
import { balanceBars } from '../public/js/lib/dashboard-data.js';
import { addToAmount, formatSignedWon, formatBalanceWon, MAX_AMOUNT } from '../public/js/lib/money.js';
import { limitText } from '../public/js/lib/categories-data.js';

const cat = (name, sortOrder, type = 'expense') => ({ name, sortOrder, type, active: true });

test('stableVizMap: 저장된 color 우선, 없으면 유형별 목록 순서 공식 ((n-1)%12)+1, 회색 없음', () => {
  const items = [...Array.from({ length: 14 }, (_, i) => cat(`c${i + 1}`, i + 1)), cat('급여', 1, 'income')];
  items[1].color = 9; // c2 는 저장된 9
  items[2].color = 9; // 겹침 허용
  const map = stableVizMap(items, 'expense');
  assert.equal(map.size, 14);
  assert.equal(map.get('c1'), 1);
  assert.equal(map.get('c2'), 9);
  assert.equal(map.get('c3'), 9);
  assert.equal(map.get('c10'), 10);
  assert.equal(map.get('c12'), 12);
  assert.equal(map.get('c13'), 1);
  assert.equal(map.get('c14'), 2);
  assert.equal(vizOf(map, '모르는 이름'), 'none');
  assert.equal(stableVizMap(items, 'income').get('급여'), 1);
  assert.equal(stableVizMap(undefined, 'expense').size, 0);
});

test('stableVizMap: color 가 범위 밖·문자열·null 이면 공식 번호', () => {
  const items = [{ ...cat('a', 1), color: 13 }, { ...cat('b', 2), color: '5' }, { ...cat('c', 3), color: null }, { ...cat('d', 4), color: 0 }];
  const map = stableVizMap(items, 'expense');
  assert.deepEqual(['a', 'b', 'c', 'd'].map((n) => map.get(n)), [1, 2, 3, 4]);
});

test('stableVizMap: 사용 안 함도 순위에 넣어 다른 카테고리 번호가 밀리지 않는다', () => {
  const items = [cat('a', 1), { ...cat('b', 2), active: false }, cat('c', 3)];
  assert.equal(stableVizMap(items, 'expense').get('c'), 3);
});

test('VIZ_NAMES: 12개, 번호로 이름을 찾는다', () => {
  assert.equal(VIZ_COUNT, 12);
  assert.equal(VIZ_NAMES.length, 12);
  assert.equal(vizName(5), '청록·격자');
  assert.equal(vizName(9), '주황·X 교차');
  assert.equal(vizName(0), '');
});

test('assignDonutViz: 저장된 번호는 겹쳐도 그대로, 번호 없는 조각만 남은 가장 작은 번호, 묶음은 other', () => {
  const map = new Map([['a', 3], ['b', 3], ['c', 1]]);
  const slices = [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'z' }, { label: '그 외 2개', members: [{}, {}] }];
  assert.deepEqual(assignDonutViz(slices, map), [3, 3, 1, 2, 'other']);
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
