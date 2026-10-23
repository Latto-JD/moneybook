// plan 9.5 사용자 데이터 격리 (C49~C51)
import { test, expect } from '@playwright/test';
import { json, get, addTx, createLoggedInUser } from '../helpers/api.js';
import { expectError } from '../helpers/errors.js';

const pick = (l) => l.transactions; // api.md 4.1

test.describe('C49 타 사용자 접근', () => {
  test('C49 B 는 A 거래를 못 보고, PUT/DELETE 는 404, A 거래는 불변', async () => {
    const A = await createLoggedInUser('isoA');
    const B = await createLoggedInUser('isoB');
    const created = await (await addTx(A.api, { memo: 'A만의 거래', amount: 7777 })).json();

    const listB = pick(await (await get(B.api, '/api/transactions?month=2026-10')).json());
    expect(listB.map((t) => t.id)).not.toContain(created.id);

    const body = { type: 'expense', amount: 1, category: '기타', memo: 'hacked', date: '2026-10-01' };
    await expectError(await json(B.api, 'PUT', `/api/transactions/${created.id}`, body), 404, 'NOT_FOUND');
    await expectError(await json(B.api, 'DELETE', `/api/transactions/${created.id}`), 404, 'NOT_FOUND');

    const listA = pick(await (await get(A.api, '/api/transactions?month=2026-10')).json());
    expect(listA.find((t) => t.id === created.id)).toMatchObject({ memo: 'A만의 거래', amount: 7777 });
  });
});

test.describe('C50 본문 userId 무시', () => {
  test('C50 B 가 userId/user_id 로 A 를 지정해도 B 소유로 저장', async () => {
    const A = await createLoggedInUser('isoA50');
    const B = await createLoggedInUser('isoB50');
    const res = await addTx(B.api, { memo: 'spoof', userId: A.user.id, user_id: A.user.id });
    expect(res.status()).toBe(201);
    const created = await res.json();
    const listA = pick(await (await get(A.api, '/api/transactions?month=2026-10')).json());
    expect(listA.map((t) => t.id)).not.toContain(created.id);
    const listB = pick(await (await get(B.api, '/api/transactions?month=2026-10')).json());
    expect(listB.map((t) => t.id)).toContain(created.id);
  });
});

test.describe('C51 집계/추천 격리', () => {
  test('C51 A 에게만 데이터가 있을 때 B 의 summary/stats/추천/인사이트는 비어 있다', async () => {
    const A = await createLoggedInUser('isoA51');
    const B = await createLoggedInUser('isoB51');
    // A: 반복되는 메모 3건으로 quick/autocomplete 후보 생성
    for (const d of ['2026-10-01', '2026-10-08', '2026-10-15']) {
      await addTx(A.api, { memo: '스타벅스', category: '카페/간식', amount: 4500, date: d });
    }
    const today = '2026-10-19';

    const s = await (await get(B.api, '/api/summary?month=2026-10')).json();
    expect(s).toMatchObject({ incomeTotal: 0, expenseTotal: 0, balance: 0 });
    expect(s.byCategory.reduce((a, c) => a + (c.total), 0)).toBe(0);

    const monthly = await (await get(B.api, '/api/stats/monthly?from=2026-05&to=2026-10')).json();
    expect(monthly.months).toHaveLength(6);
    for (const m of monthly.months) expect(m).toMatchObject({ incomeTotal: 0, expenseTotal: 0, balance: 0, count: 0 });

    const cats = await (await get(B.api, '/api/stats/categories?from=2026-10&to=2026-10')).json();
    expect(cats).toMatchObject({ grandTotal: 0, items: [] });

    const cm = await (await get(B.api, '/api/stats/category-monthly?from=2026-05&to=2026-10')).json();
    expect(cm.series).toEqual([]);

    const quick = await (await get(B.api, `/api/recommendations/quick?type=expense&today=${today}`)).json();
    expect(quick).toEqual({ items: [] });
    const ac = await (await get(B.api, `/api/recommendations/autocomplete?q=${encodeURIComponent('스')}&type=expense&today=${today}`)).json();
    expect(ac).toEqual({ items: [] });

    const ins = await (await get(B.api, `/api/insights?month=2026-10&today=${today}`)).json();
    expect(ins).toEqual({ month: '2026-10', recurring: [], overspending: [], largeExpenses: [], incomeDrops: [], missingIncome: [] });
  });
});
