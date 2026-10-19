// plan 9.6 대시보드 API (C52~C55). C56 은 transactions.spec.js
import { test, expect } from '@playwright/test';
import { get, addTx, createLoggedInUser } from '../helpers/api.js';
import { expectError } from '../helpers/errors.js';

async function seedStats(api) {
  // 2026-08 지출 10000(식비), 2026-10 수입 500000, 지출 식비 30000 / 교통 20000 / 쇼핑 20000. 9월은 비움.
  await addTx(api, { date: '2026-08-10', category: '식비', amount: 10000 });
  await addTx(api, { type: 'income', date: '2026-10-01', category: '급여', amount: 500000 });
  await addTx(api, { date: '2026-10-02', category: '식비', amount: 30000 });
  await addTx(api, { date: '2026-10-03', category: '교통', amount: 20000 });
  await addTx(api, { date: '2026-10-04', category: '쇼핑', amount: 20000 });
}

test.describe('C52 monthly', () => {
  test('C52 6개월, 오래된 순, 빈 달 0, balance=수입-지출', async () => {
    const { api } = await createLoggedInUser('c52');
    await seedStats(api);
    const r = await get(api, '/api/stats/monthly?from=2026-05&to=2026-10');
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ from: '2026-05', to: '2026-10' });
    expect(b.months.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    const byMonth = Object.fromEntries(b.months.map((m) => [m.month, m]));
    expect(byMonth['2026-09']).toMatchObject({ incomeTotal: 0, expenseTotal: 0, balance: 0, count: 0 });
    expect(byMonth['2026-08']).toMatchObject({ expenseTotal: 10000, balance: -10000, count: 1 });
    expect(byMonth['2026-10']).toMatchObject({ incomeTotal: 500000, expenseTotal: 70000, balance: 430000, count: 4 });
  });
});

test.describe('C53 categories', () => {
  test('C53 합계/정렬/ratio/0 제외 (동률은 고정 순서: 교통 < 쇼핑)', async () => {
    const { api } = await createLoggedInUser('c53');
    await seedStats(api);
    const b = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10')).json();
    expect(b).toMatchObject({ from: '2026-10', to: '2026-10', type: 'expense', grandTotal: 70000 });
    expect(b.items.map((i) => i.category)).toEqual(['식비', '교통', '쇼핑']);
    expect(b.items.reduce((a, i) => a + i.total, 0)).toBe(b.grandTotal);
    expect(b.items.map((i) => i.ratio)).toEqual([0.4286, 0.2857, 0.2857]);
    expect(b.items.every((i) => i.total > 0)).toBe(true);
  });
  test('C53 데이터 없음 -> grandTotal 0, items []', async () => {
    const { api } = await createLoggedInUser('c53e');
    const b = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10')).json();
    expect(b).toMatchObject({ grandTotal: 0, items: [] });
  });
  test('C53 type=income', async () => {
    const { api } = await createLoggedInUser('c53i');
    await seedStats(api);
    const b = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10&type=income')).json();
    expect(b).toMatchObject({ type: 'income', grandTotal: 500000 });
    expect(b.items).toEqual([expect.objectContaining({ category: '급여', total: 500000, ratio: 1 })]);
  });
});

test.describe('C54 category-monthly', () => {
  test('C54 totals 길이/sum/월별 합이 monthly 와 일치', async () => {
    const { api } = await createLoggedInUser('c54');
    await seedStats(api);
    const cm = await (await get(api, '/api/stats/category-monthly?from=2026-05&to=2026-10')).json();
    const mo = await (await get(api, '/api/stats/monthly?from=2026-05&to=2026-10')).json();
    expect(cm.months).toHaveLength(6);
    for (const s of cm.series) {
      expect(s.totals).toHaveLength(cm.months.length);
      expect(s.sum).toBe(s.totals.reduce((a, v) => a + v, 0));
      expect(s.sum).toBeGreaterThan(0);
    }
    const sums = cm.series.map((s) => s.sum);
    expect(sums).toEqual([...sums].sort((a, b) => b - a));
    cm.months.forEach((_, i) => {
      const col = cm.series.reduce((a, s) => a + s.totals[i], 0);
      expect(col).toBe(mo.months[i].expenseTotal);
    });
  });
});

test.describe('C55 검증', () => {
  const bad = [
    ['from > to', 'from=2026-10&to=2026-05'],
    ['25개월', 'from=2024-10&to=2026-10'],
    ['2026-13', 'from=2026-13&to=2026-13'],
    ['2026-1', 'from=2026-1&to=2026-10'],
    ['from 누락', 'to=2026-10'],
    ['to 누락', 'from=2026-10'],
    ['type=foo', 'from=2026-10&to=2026-10&type=foo'],
  ];
  for (const path of ['monthly', 'categories', 'category-monthly']) {
    for (const [label, qs] of bad) {
      // api.md 5장: monthly 도 type 이 expense|income 이 아니면 400
      test(`C55 ${path} ${label} -> 400`, async () => {
        const { api } = await createLoggedInUser('c55');
        await expectError(await get(api, `/api/stats/${path}?${qs}`), 400, 'VALIDATION_ERROR');
      });
    }
    test(`C55 ${path} 24개월은 200`, async () => {
      const { api } = await createLoggedInUser('c55ok');
      const r = await get(api, `/api/stats/${path}?from=2024-11&to=2026-10`);
      expect(r.status()).toBe(200);
      if (path === 'monthly') expect((await r.json()).months).toHaveLength(24);
    });
  }
});
