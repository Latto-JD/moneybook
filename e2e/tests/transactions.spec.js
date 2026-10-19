// plan 9.2 거래 API / 검증 (C6~C13), C56
// 계약: docs/api.md (목록 {month, transactions:[...]}, summary.byCategory[].total)
import { test, expect } from '@playwright/test';
import { json, get, addTx, createLoggedInUser } from '../helpers/api.js';
import { expectError } from '../helpers/errors.js';

const BASE = { type: 'expense', amount: 4500, category: '식비', memo: '점심', date: '2026-10-05' };
const ZERO_ID = '00000000-0000-4000-8000-000000000000';

test.describe('C6 생성/조회', () => {
  test('C6 POST 201, id/createdAt 있고 userId 없음, 목록에 나타남', async () => {
    const { api } = await createLoggedInUser('c6');
    const res = await json(api, 'POST', '/api/transactions', BASE);
    expect(res.status()).toBe(201);
    const tx = await res.json();
    expect(tx).toMatchObject(BASE);
    expect(tx.id).toEqual(expect.any(String));
    expect(tx.createdAt).toEqual(expect.any(String));
    expect(tx).not.toHaveProperty('userId');
    expect(tx).not.toHaveProperty('user_id');

    const list = await get(api, '/api/transactions?month=2026-10');
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.month).toBe('2026-10');
    expect(body.transactions.map((t) => t.id)).toContain(tx.id);
  });
});

test.describe('C7 400 검증', () => {
  const bad = [
    ['amount 0', { amount: 0 }],
    ['amount 음수', { amount: -1 }],
    ['amount 1.5', { amount: 1.5 }],
    ['amount 문자열', { amount: '1000' }],
    ['amount 100,000,001', { amount: 100000001 }],
    ['type 누락', { type: undefined }],
    ['type 잘못된 값', { type: 'transfer' }],
    ['income + 식비', { type: 'income', category: '식비' }],
    ['date 2026-02-30', { date: '2026-02-30' }],
    ['date 2026-13-01', { date: '2026-13-01' }],
    ['date 20261019', { date: '20261019' }],
    ['memo 51자', { memo: 'a'.repeat(51) }],
  ];
  for (const [label, patch] of bad) {
    test(`C7 ${label} -> 400 VALIDATION_ERROR`, async () => {
      const { api } = await createLoggedInUser('c7');
      await expectError(await json(api, 'POST', '/api/transactions', { ...BASE, ...patch }), 400, 'VALIDATION_ERROR');
    });
  }
  test('C7 잘못된 JSON -> 400 INVALID_JSON', async () => {
    const { api } = await createLoggedInUser('c7json');
    const res = await api.fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, data: '{"type": "expense", ', failOnStatusCode: false,
    });
    await expectError(res, 400, 'INVALID_JSON');
  });
});

test.describe('C8 경계값 201', () => {
  for (const [label, patch] of [
    ['amount 1', { amount: 1 }],
    ['amount 100,000,000', { amount: 100000000 }],
    ['memo 50자', { memo: 'a'.repeat(50) }],
  ]) {
    test(`C8 ${label} -> 201`, async () => {
      const { api } = await createLoggedInUser('c8');
      expect((await json(api, 'POST', '/api/transactions', { ...BASE, ...patch })).status()).toBe(201);
    });
  }
});

test.describe('C9/C10 수정/삭제', () => {
  test('C9 PUT 수정이 GET 에 반영', async () => {
    const { api } = await createLoggedInUser('c9');
    const created = await (await addTx(api, BASE)).json();
    const upd = { ...BASE, amount: 9900, memo: '수정됨', category: '카페/간식' };
    const res = await json(api, 'PUT', `/api/transactions/${created.id}`, upd);
    expect(res.status()).toBe(200);
    const list = await (await get(api, '/api/transactions?month=2026-10')).json();
    const arr = list.transactions;
    expect(arr.find((t) => t.id === created.id)).toMatchObject(upd);
  });
  test('C9 없는 UUID / 비UUID id 에 PUT/DELETE -> 404 NOT_FOUND', async () => {
    const { api } = await createLoggedInUser('c9nf');
    for (const id of [ZERO_ID, 'not-a-uuid', '123']) {
      await expectError(await json(api, 'PUT', `/api/transactions/${id}`, BASE), 404, 'NOT_FOUND');
      await expectError(await json(api, 'DELETE', `/api/transactions/${id}`), 404, 'NOT_FOUND');
    }
  });
  test('C10 DELETE 204 후 목록에서 사라짐', async () => {
    const { api } = await createLoggedInUser('c10');
    const created = await (await addTx(api, BASE)).json();
    expect((await json(api, 'DELETE', `/api/transactions/${created.id}`)).status()).toBe(204);
    const list = await (await get(api, '/api/transactions?month=2026-10')).json();
    const arr = list.transactions;
    expect(arr.map((t) => t.id)).not.toContain(created.id);
  });
});

test.describe('C12 동시성', () => {
  test('C12 같은 사용자 POST 20건 병렬 -> 모두 201, 목록 정확히 +20', async () => {
    const { api } = await createLoggedInUser('c12');
    const month = '2026-09';
    const before = await (await get(api, `/api/transactions?month=${month}`)).json();
    const nBefore = before.transactions.length;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => addTx(api, { amount: 1000 + i, memo: `par${i}`, date: '2026-09-15' })),
    );
    expect(results.map((r) => r.status())).toEqual(Array(20).fill(201));
    const after = await (await get(api, `/api/transactions?month=${month}`)).json();
    expect(after.transactions.length).toBe(nBefore + 20);
  });
});

test.describe('C13 요약', () => {
  test('C13 summary 수동 계산 일치, 빈 달은 0', async () => {
    const { api } = await createLoggedInUser('c13');
    await addTx(api, { type: 'income', category: '급여', amount: 3000000, date: '2026-10-01' });
    await addTx(api, { type: 'expense', category: '식비', amount: 12000, date: '2026-10-02' });
    await addTx(api, { type: 'expense', category: '식비', amount: 8000, date: '2026-10-03' });
    await addTx(api, { type: 'expense', category: '교통', amount: 1500, date: '2026-10-04' });
    const s = await (await get(api, '/api/summary?month=2026-10')).json();
    expect(s).toMatchObject({ incomeTotal: 3000000, expenseTotal: 21500, balance: 3000000 - 21500 });
    const by = Object.fromEntries(s.byCategory.map((c) => [c.category, c.total]));
    expect(by['식비']).toBe(20000);
    expect(by['교통']).toBe(1500);
    expect(s.byCategory.reduce((a, c) => a + c.total, 0)).toBe(s.expenseTotal);

    const empty = await (await get(api, '/api/summary?month=2020-01')).json();
    expect(empty).toMatchObject({ incomeTotal: 0, expenseTotal: 0, balance: 0 });
  });
});

test.describe('C56 월 경계', () => {
  test('C56 09-30 / 10-01 이 각각 9월/10월, date 값 보존', async () => {
    const { api } = await createLoggedInUser('c56');
    await addTx(api, { date: '2026-09-30', amount: 1111, memo: 'sep' });
    await addTx(api, { date: '2026-10-01', amount: 2222, memo: 'oct' });
    const pick = (l) => l.transactions;
    const sep = pick(await (await get(api, '/api/transactions?month=2026-09')).json());
    const oct = pick(await (await get(api, '/api/transactions?month=2026-10')).json());
    expect(sep.map((t) => [t.memo, t.date])).toEqual([['sep', '2026-09-30']]);
    expect(oct.map((t) => [t.memo, t.date])).toEqual([['oct', '2026-10-01']]);
    const s9 = await (await get(api, '/api/summary?month=2026-09')).json();
    const s10 = await (await get(api, '/api/summary?month=2026-10')).json();
    expect(s9.expenseTotal).toBe(1111);
    expect(s10.expenseTotal).toBe(2222);
  });
});

test.describe('C47 인젝션 문자열 저장', () => {
  test('C47 SQL/HTML 메모가 그대로 저장/조회', async () => {
    const { api } = await createLoggedInUser('c47');
    const memos = ["' OR 1=1 --", '<img src=x onerror=alert(1)>'];
    for (const memo of memos) {
      const res = await addTx(api, { memo });
      expect(res.status()).toBe(201);
    }
    const list = await (await get(api, '/api/transactions?month=2026-10')).json();
    const got = list.transactions.map((t) => t.memo);
    for (const m of memos) expect(got).toContain(m);
  });
});
