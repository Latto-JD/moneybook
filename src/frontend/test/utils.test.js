import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatWon, formatNumber, formatAmountInput } from '../public/js/lib/money.js';
import {
  todayLocal, shiftMonth, monthRange, monthsBetween, trailingRange, isValidDate, isValidMonth,
  daysInMonth, monthTitle, monthShort, dayLabel,
} from '../public/js/lib/date.js';
import {
  validateEmail, validatePassword, validateAmount, validateMemo, validateTransaction,
} from '../public/js/lib/validate.js';

test('parseAmount: 유효/무효', () => {
  assert.equal(parseAmount('12,500'), 12500);
  assert.equal(parseAmount('12500'), 12500);
  assert.equal(parseAmount(' 12,500원 '), 12500);
  assert.equal(parseAmount('1'), 1);
  assert.equal(parseAmount('100,000,000'), 100000000);
  for (const bad of ['abc', '', '0', '-5', '1.5', '100,000,001', '1,2', '12,50', null, undefined, NaN, 0, 1.5, -1]) {
    assert.equal(parseAmount(bad), null, `bad: ${String(bad)}`);
  }
});

test('formatWon / formatNumber', () => {
  assert.equal(formatWon(12500), '12,500원');
  assert.equal(formatWon(0), '0원');
  assert.equal(formatWon(1234567), '1,234,567원');
  assert.equal(formatNumber(-1500), '-1,500');
  assert.equal(formatWon(NaN), '0원');
  assert.equal(formatWon(undefined), '0원');
  assert.equal(formatWon(Infinity), '0원');
});

test('formatAmountInput: 실시간 콤마', () => {
  assert.equal(formatAmountInput('12500'), '12,500');
  assert.equal(formatAmountInput('12a5,00'), '12,500');
  assert.equal(formatAmountInput('abc'), '');
  assert.equal(formatAmountInput('0012'), '12');
  assert.equal(formatAmountInput(null), '');
});

test('todayLocal: 로컬 시각 기준 (UTC 변환 없음)', () => {
  assert.equal(todayLocal(new Date(2026, 9, 19, 0, 30)), '2026-10-19');
  assert.equal(todayLocal(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test('shiftMonth / monthRange / daysInMonth', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-10', -11), '2025-11');
  assert.equal(shiftMonth('2026-10', 0), '2026-10');
  assert.equal(shiftMonth('2026-13', 1), null);
  assert.equal(shiftMonth('2026-10', 1.5), null);
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(monthRange('2026-10'), { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(monthRange('bad'), null);
  assert.equal(daysInMonth('2026-04'), 30);
});

test('monthsBetween / trailingRange', () => {
  assert.deepEqual(monthsBetween('2026-05', '2026-10'), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(monthsBetween('2025-11', '2026-10').length, 12);
  assert.deepEqual(monthsBetween('2026-10', '2026-10'), ['2026-10']);
  assert.deepEqual(monthsBetween('2026-10', '2026-05'), []);
  assert.deepEqual(monthsBetween('x', '2026-05'), []);
  assert.deepEqual(trailingRange('2026-10', 6), { from: '2026-05', to: '2026-10' });
  assert.deepEqual(trailingRange('2026-02', 12), { from: '2025-03', to: '2026-02' });
  assert.equal(trailingRange('2026-10', 0), null);
});

test('isValidDate / isValidMonth', () => {
  assert.equal(isValidDate('2026-10-19'), true);
  assert.equal(isValidDate('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '20261019', '2026-02-29', '2026-10-00', '', null, '2026-1-01']) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
  assert.equal(isValidMonth('2026-10'), true);
  assert.equal(isValidMonth('2026-1'), false);
  assert.equal(isValidMonth('2026-13'), false);
});

test('라벨', () => {
  assert.equal(monthTitle('2026-10'), '2026년 10월');
  assert.equal(monthShort('2026-05'), '5월');
  assert.equal(dayLabel('2026-10-19', '2026-10-19'), '오늘');
  assert.equal(dayLabel('2026-10-18', '2026-10-19'), '10월 18일 (일)');
  assert.equal(dayLabel('bad', '2026-10-19'), '');
});

test('validateEmail', () => {
  assert.deepEqual(validateEmail('  A@Ex.com '), { ok: true, value: 'a@ex.com' });
  for (const bad of ['a@b', 'ab.com', 'a b@ex.com', 'a@@ex.com', '@ex.com', 'a@.com', 'a@ex.', '', '   ', 'a@ex..com']) {
    assert.equal(validateEmail(bad).ok, false, bad);
  }
  assert.equal(validateEmail('a'.repeat(250) + '@e.co').ok, false); // 254자 초과
});

test('validatePassword: 8~128자, 공백 보존', () => {
  assert.equal(validatePassword('1234567').ok, false);
  assert.equal(validatePassword('12345678').ok, true);
  assert.equal(validatePassword('x'.repeat(128)).ok, true);
  assert.equal(validatePassword('x'.repeat(129)).ok, false);
  assert.equal(validatePassword('  abcdef  ').value, '  abcdef  ');
  assert.equal(validatePassword(undefined).ok, false);
  // 코드포인트 기준: 이모지 128개는 통과, 129개는 실패
  assert.equal(validatePassword('😀'.repeat(128)).ok, true);
  assert.equal(validatePassword('😀'.repeat(129)).ok, false);
  assert.equal(validatePassword('😀'.repeat(4)).ok, false);
});

test('validateAmount / validateMemo', () => {
  assert.equal(validateAmount('0').ok, false);
  assert.equal(validateAmount('1,000').value, 1000);
  assert.equal(validateMemo('a'.repeat(50)).ok, true);
  assert.equal(validateMemo('a'.repeat(51)).ok, false);
  assert.equal(validateMemo('  커피  ').value, '커피');
});

test('validateTransaction', () => {
  const ok = validateTransaction({ type: 'expense', amount: '4,500', category: '카페/간식', memo: ' 아메리카노 ', date: '2026-10-19' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { type: 'expense', amount: 4500, category: '카페/간식', memo: '아메리카노', date: '2026-10-19' });
  const bad = validateTransaction({ type: 'income', amount: '', category: '식비', memo: '', date: '2026-02-30' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'category', 'date']);
});
