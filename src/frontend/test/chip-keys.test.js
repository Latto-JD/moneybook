import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSubmitOnChipEnter } from '../public/js/lib/chip-keys.js';

test('선택된 칩에서 Enter 는 저장', () => {
  assert.equal(shouldSubmitOnChipEnter({ key: 'Enter', pressed: true }), true);
});
test('선택 전 칩의 Enter 는 기본 동작(선택)', () => {
  assert.equal(shouldSubmitOnChipEnter({ key: 'Enter', pressed: false }), false);
});
test('Space/Tab/방향키는 저장하지 않음', () => {
  for (const key of [' ', 'Tab', 'ArrowRight', 'Escape']) {
    assert.equal(shouldSubmitOnChipEnter({ key, pressed: true }), false);
  }
});
test('IME 조합 중이거나 키 반복이면 저장하지 않음', () => {
  assert.equal(shouldSubmitOnChipEnter({ key: 'Enter', pressed: true, isComposing: true }), false);
  assert.equal(shouldSubmitOnChipEnter({ key: 'Enter', pressed: true, repeat: true }), false);
});
test('인자 없음', () => {
  assert.equal(shouldSubmitOnChipEnter(), false);
});
