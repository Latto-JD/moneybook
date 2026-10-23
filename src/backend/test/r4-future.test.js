// B4: 진행 중인 달의 오늘 이후 거래는 R4 에서 뺀다 / A11: insights 조회 범위가 I1 상수를 따른다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOverspending } from '../rules/overspending.js';
import { INCOME_DROP } from '../rules/income.js';
import { insightsFrom } from '../rules/routes.js';

let seq = 0;
const t = (date, amount, category = '식비', memo = '') => ({
  id: `f${++seq}`,
  type: 'expense',
  amount,
  category,
  memo,
  date,
  createdAt: `2026-01-01T00:00:00.${String(seq).padStart(4, '0')}Z`,
});
const base = () => ['2026-06', '2026-07', '2026-08'].map((m, i) => t(`${m}-10`, 100000, '식비', `기준${i}`));
const TODAY = '2026-09-10';

test('B4 미래 날짜 제외: 오늘 이후 입력분은 currentTotal·exceeded 에 안 들어간다', () => {
  const txs = [...base(), t('2026-09-25', 130000, '식비', '미리입력')];
  assert.deepEqual(detectOverspending(txs, '2026-09', TODAY), []);
  const mixed = [...base(), t('2026-09-02', 120000, '식비', '점심'), t('2026-09-25', 50000, '식비', '미리')];
  const r = detectOverspending(mixed, '2026-09', TODAY);
  assert.equal(r.length, 1);
  assert.equal(r[0].currentTotal, 120000);
});

test('B4 오늘 포함: date == today 는 센다, 하루 뒤는 뺀다', () => {
  const on = [...base(), t(TODAY, 120000, '식비', 'a')];
  assert.equal(detectOverspending(on, '2026-09', TODAY)[0].currentTotal, 120000);
  const next = [...base(), t('2026-09-11', 120000, '식비', 'a')];
  assert.deepEqual(detectOverspending(next, '2026-09', TODAY), []);
});

test('B4 pace 건수·합계에서도 미래 거래 제외', () => {
  const txs = [...base(), t('2026-09-02', 20000, '식비', 'a'), t('2026-09-25', 24000, '식비', 'b')];
  assert.deepEqual(detectOverspending(txs, '2026-09', TODAY), [], '비반복 1건뿐이라 pace 아님');
});

test('B4 지난 달·미래 달 조회는 영향 없음(월 전체 거래를 그대로 쓴다)', () => {
  const past = [...base(), t('2026-09-25', 130000, '식비', '미리입력')];
  const r = detectOverspending(past, '2026-09', '2026-10-15');
  assert.equal(r.length, 1);
  assert.equal(r[0].currentTotal, 130000);
  const future = [...base(), t('2026-09-25', 130000, '식비', 'x')];
  assert.equal(detectOverspending(future, '2026-09', '2026-08-31').length, 1);
});

test('A11 insights 조회 시작은 I1 기준 개월 수를 따른다', () => {
  const month = '2026-09';
  const today = '2026-09-10';
  assert.equal(insightsFrom(month, today), '2025-08-07', '기본(R3 400일 창이 가장 이름)');
  const saved = INCOME_DROP.baselineMonths;
  try {
    // 400일 창보다 이른 값이 되도록 큰 값으로 바꿔 I1 후보가 선택되는지 고정
    INCOME_DROP.baselineMonths = 20;
    assert.equal(insightsFrom(month, today), '2025-01-01');
    INCOME_DROP.baselineMonths = 4;
    assert.equal(insightsFrom(month, today), '2025-08-07');
  } finally {
    INCOME_DROP.baselineMonths = saved;
  }
});
