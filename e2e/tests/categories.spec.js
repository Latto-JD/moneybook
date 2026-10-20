// docs/plan-categories.md 13.1~13.3 (C-C5 일부, C-C6~C-C22) 카테고리 API e2e. 계약: docs/api.md v3 3A장.
// 사용자마다 새 계정을 만들어 격리한다. 마이그레이션/구버전 호환은 categories-migration.spec.js.
import { test, expect } from '@playwright/test';
import { get, json, addTx, createLoggedInUser, newApi } from '../helpers/api.js';
import { expectError } from '../helpers/errors.js';

const DEFAULT_EXPENSE = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'];
const DEFAULT_INCOME = ['급여', '용돈', '부수입', '기타'];
const TODAY = '2026-10-19';

const listCats = async (api) => (await get(api, '/api/categories')).json();
const find = (body, type, name) => body.items.find((i) => i.type === type && i.name === name);
const postCat = (api, type, name) => json(api, 'POST', '/api/categories', { type, name });
const patchCat = (api, id, body) => json(api, 'PATCH', `/api/categories/${id}`, body);
async function mk(api, type, name) {
  const r = await postCat(api, type, name);
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}
async function setActive(api, type, name, active) {
  const b = await listCats(api);
  const it = find(b, type, name);
  const r = await patchCat(api, it.id, { active });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
const txs = async (api, month) => (await (await get(api, `/api/transactions?month=${month}`)).json()).transactions;
const stat = async (api, path) => (await get(api, `/api/stats/${path}`)).json();

test.describe('C-C6 기본 세트', () => {
  test('C-C6 가입 직후 expense/income 이 기존 고정 목록, items 12개 모두 active, sortOrder 0부터', async () => {
    const { api } = await createLoggedInUser('cc6');
    const b = await listCats(api);
    expect(b.expense).toEqual(DEFAULT_EXPENSE);
    expect(b.income).toEqual(DEFAULT_INCOME);
    expect(b.items).toHaveLength(12);
    expect(b.items.every((i) => i.active === true && i.usedCount === 0)).toBe(true);
    expect(b.items.filter((i) => i.type === 'expense').map((i) => i.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(b.items.filter((i) => i.type === 'income').map((i) => i.name)).toEqual(DEFAULT_INCOME);
    // 지출 먼저, 그다음 수입
    expect(b.items.map((i) => i.type)).toEqual([...Array(8).fill('expense'), ...Array(4).fill('income')]);
    for (const i of b.items) expect(Object.keys(i).sort()).toEqual(['active', 'id', 'name', 'sortOrder', 'type', 'usedCount']);
  });
});

test.describe('C-C7/C-C8 추가와 이름 검증', () => {
  test('C-C7 "  반려   동물 " -> 201, 정규화, 맨 끝, expense 배열 맨 끝', async () => {
    const { api } = await createLoggedInUser('cc7');
    const r = await postCat(api, 'expense', '  반려   동물 ');
    expect(r.status()).toBe(201);
    const c = await r.json();
    expect(c).toMatchObject({ type: 'expense', name: '반려 동물', active: true, sortOrder: 8, usedCount: 0 });
    const b = await listCats(api);
    expect(b.expense.at(-1)).toBe('반려 동물');
    expect(b.expense).toHaveLength(9);
    expect(b.income).toEqual(DEFAULT_INCOME);
    const c2 = await mk(api, 'expense', '두번째');
    expect(c2.sortOrder).toBe(9);
    expect((await listCats(api)).expense.slice(-2)).toEqual(['반려 동물', '두번째']);
  });

  test('C-C7 NFC 정규화 (분해형 한글 -> 조합형)', async () => {
    const { api } = await createLoggedInUser('cc7n');
    const c = await mk(api, 'income', '이자'.normalize('NFD'));
    expect(c.name).toBe('이자'.normalize('NFC'));
    expect(c.name.length).toBe(2);
  });

  for (const [label, body] of [
    ['빈 문자열', { type: 'expense', name: '' }],
    ['공백만', { type: 'expense', name: '   ' }],
    ['탭/줄바꿈만', { type: 'expense', name: '\t\n ' }],
    ['16자', { type: 'expense', name: '가'.repeat(16) }],
    ['제어문자(NUL)', { type: 'expense', name: 'a\u0000b' }],
    ['제어문자(DEL)', { type: 'expense', name: 'a\u007fb' }],
    ['숫자 타입', { type: 'expense', name: 123 }],
    ['null', { type: 'expense', name: null }],
    ['name 없음', { type: 'expense' }],
    ['type transfer', { type: 'transfer', name: '이체' }],
    ['type 없음', { name: '이체' }],
  ]) {
    test(`C-C8 ${label} -> 400 VALIDATION_ERROR + fields`, async () => {
      const { api } = await createLoggedInUser('cc8');
      const e = await expectError(await json(api, 'POST', '/api/categories', body), 400, 'VALIDATION_ERROR');
      expect(e.fields).toBeTruthy();
      expect(e.fields.name || e.fields.type).toBeTruthy();
      expect((await listCats(api)).items).toHaveLength(12);
    });
  }

  test('C-C8 15자 경계 201 (코드포인트 기준: 이모지 포함 15자도 201), 꺾쇠 이름은 그대로', async () => {
    const { api } = await createLoggedInUser('cc8b');
    expect((await mk(api, 'expense', '가'.repeat(15))).name).toBe('가'.repeat(15));
    const emoji = '😀'.repeat(15);
    const r = await postCat(api, 'income', emoji);
    expect(r.status(), await r.text()).toBe(201);
    expect((await r.json()).name).toBe(emoji);
    expect((await postCat(api, 'income', '😀'.repeat(16))).status()).toBe(400);
    const xss = '<b onclick=x>';
    expect(xss.length).toBeLessThanOrEqual(15);
    const c = await mk(api, 'expense', xss);
    expect(c.name).toBe(xss);
    expect((await listCats(api)).expense).toContain(xss);
    // 응답에도 그대로 저장되어 거래에 쓸 수 있다
    expect((await addTx(api, { category: xss, amount: 1000 })).status()).toBe(201);
  });

  test('C-C8 알 수 없는 본문 필드(userId, active, sortOrder)는 무시', async () => {
    const { api } = await createLoggedInUser('cc8c');
    const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: '무시테스트', active: false, sortOrder: 0, userId: '00000000-0000-4000-8000-000000000000', id: 'x' });
    expect(r.status()).toBe(201);
    const c = await r.json();
    expect(c.active).toBe(true);
    expect(c.sortOrder).toBe(8);
  });
});

test.describe('C-C9/C-C10 중복과 복구', () => {
  test('C-C9 "식비", " 식비 " -> 409 CATEGORY_EXISTS. Netflix/netflix 409. 수입에 "식비" 201', async () => {
    const { api } = await createLoggedInUser('cc9');
    await expectError(await postCat(api, 'expense', '식비'), 409, 'CATEGORY_EXISTS');
    await expectError(await postCat(api, 'expense', ' 식비 '), 409, 'CATEGORY_EXISTS');
    await mk(api, 'expense', 'Netflix');
    await expectError(await postCat(api, 'expense', 'netflix'), 409, 'CATEGORY_EXISTS');
    await expectError(await postCat(api, 'expense', ' NETFLIX '), 409, 'CATEGORY_EXISTS');
    const c = await mk(api, 'income', '식비');
    expect(c.type).toBe('income');
    // 기타 는 양쪽에 이미 있어도 각자 유지
    const b = await listCats(api);
    expect(b.items.filter((i) => i.name === '기타')).toHaveLength(2);
  });

  test('C-C9 연속 공백 정규화 후 중복: "카페/간식" vs "카페/ 간식" 은 다른 이름, "반려  동물" == "반려 동물"', async () => {
    const { api } = await createLoggedInUser('cc9b');
    await mk(api, 'expense', '반려 동물');
    await expectError(await postCat(api, 'expense', '반려    동물'), 409, 'CATEGORY_EXISTS');
    expect((await postCat(api, 'expense', '카페/ 간식')).status()).toBe(201);
  });

  test('C-C9 같은 이름 동시 POST 2건 -> 정확히 1건 201, 나머지 409, 행은 1개', async () => {
    const { api } = await createLoggedInUser('cc9c');
    const rs = await Promise.all([1, 2, 3].map(() => postCat(api, 'expense', '동시생성')));
    const st = rs.map((r) => r.status()).sort();
    expect(st, JSON.stringify(st)).toEqual([201, 409, 409]);
    expect((await listCats(api)).items.filter((i) => i.name === '동시생성')).toHaveLength(1);
  });

  test('C-C10 사용 안 함 "교통" 재추가 -> 409 CATEGORY_INACTIVE + categoryId, PATCH active:true 로 복구, sortOrder 유지, stats 유지', async () => {
    const { api } = await createLoggedInUser('cc10');
    await addTx(api, { category: '교통', amount: 3000, date: '2026-10-02' });
    const before = find(await listCats(api), 'expense', '교통');
    expect(before.sortOrder).toBe(2);
    expect(before.usedCount).toBe(1);
    await setActive(api, 'expense', '교통', false);
    expect((await listCats(api)).expense).not.toContain('교통');
    const e = await expectError(await postCat(api, 'expense', '교통'), 409, 'CATEGORY_INACTIVE');
    expect(e.categoryId).toBe(before.id);
    await expectError(await postCat(api, 'expense', ' 교통 '), 409, 'CATEGORY_INACTIVE');
    // 사용 안 함 상태에서도 stats 에 그대로
    const st = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    expect(st.items.map((i) => [i.category, i.total])).toEqual([['교통', 3000]]);
    const r = await patchCat(api, e.categoryId, { active: true });
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ id: before.id, name: '교통', active: true, sortOrder: 2, usedCount: 1 });
    expect((await listCats(api)).expense).toEqual(DEFAULT_EXPENSE); // 원래 순서 위치
  });
});

test.describe('C-C11 이름 변경 연동', () => {
  test('C-C11 3개월 카페/간식 5건 -> "커피": 목록/summary/stats/category-monthly 모두 새 이름, 합계 동일, 타 사용자·타 유형 불변', async () => {
    const A = await createLoggedInUser('cc11a');
    const B = await createLoggedInUser('cc11b');
    const coffee = [['2026-08-03', 4000], ['2026-08-20', 4500], ['2026-09-05', 5000], ['2026-10-02', 3500], ['2026-10-11', 6000]];
    for (const [date, amount] of coffee) await addTx(A.api, { category: '카페/간식', amount, date, memo: '라떼' });
    await addTx(A.api, { category: '식비', amount: 9000, date: '2026-10-03' });
    await addTx(A.api, { category: '기타', amount: 1111, date: '2026-10-04' });
    await addTx(A.api, { type: 'income', category: '기타', amount: 2222, date: '2026-10-05' });
    await addTx(B.api, { category: '카페/간식', amount: 7777, date: '2026-10-06' });
    await addTx(B.api, { category: '기타', amount: 8888, date: '2026-10-06' });

    const catsBefore = await stat(A.api, 'categories?from=2026-08&to=2026-10&type=expense');
    const cmBefore = await stat(A.api, 'category-monthly?from=2026-08&to=2026-10&type=expense');
    const sumBefore = await (await get(A.api, '/api/summary?month=2026-10')).json();
    const cafeBefore = catsBefore.items.find((i) => i.category === '카페/간식');
    expect(cafeBefore).toMatchObject({ total: 23000, count: 5 });
    expect(find(await listCats(A.api), 'expense', '카페/간식').usedCount).toBe(5);

    const id = find(await listCats(A.api), 'expense', '카페/간식').id;
    const r = await patchCat(A.api, id, { name: '커피' });
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ id, name: '커피', sortOrder: 1, usedCount: 5, active: true });

    for (const m of ['2026-08', '2026-09', '2026-10']) {
      const list = await txs(A.api, m);
      expect(list.filter((t) => t.category === '카페/간식'), m).toHaveLength(0);
    }
    expect((await txs(A.api, '2026-10')).filter((t) => t.category === '커피')).toHaveLength(2);
    const catsAfter = await stat(A.api, 'categories?from=2026-08&to=2026-10&type=expense');
    expect(catsAfter.items.map((i) => i.category)).not.toContain('카페/간식');
    expect(catsAfter.items.find((i) => i.category === '커피')).toMatchObject({ total: cafeBefore.total, count: cafeBefore.count, ratio: cafeBefore.ratio });
    expect(catsAfter.grandTotal).toBe(catsBefore.grandTotal);
    const cmAfter = await stat(A.api, 'category-monthly?from=2026-08&to=2026-10&type=expense');
    const sOld = cmBefore.series.find((s) => s.category === '카페/간식');
    const sNew = cmAfter.series.find((s) => s.category === '커피');
    expect(cmAfter.series.find((s) => s.category === '카페/간식')).toBeUndefined();
    expect(sNew).toMatchObject({ totals: sOld.totals, sum: sOld.sum });
    const sumAfter = await (await get(A.api, '/api/summary?month=2026-10')).json();
    expect(sumAfter.expenseTotal).toBe(sumBefore.expenseTotal);
    expect(sumAfter.byCategory.map((c) => c.category)).not.toContain('카페/간식');
    expect(sumAfter.byCategory.find((c) => c.category === '커피').total).toBe(9500);
    // 새 이름으로 거래 입력 가능 / 옛 이름은 이제 목록에 없음 -> 400
    expect((await addTx(A.api, { category: '커피', amount: 1000 })).status()).toBe(201);
    expect((await addTx(A.api, { category: '카페/간식', amount: 1000 })).status()).toBe(400);

    // 타 사용자 불변
    const bTx = await txs(B.api, '2026-10');
    expect(bTx.map((t) => t.category).sort()).toEqual(['기타', '카페/간식']);
    expect((await listCats(B.api)).expense).toContain('카페/간식');

    // 지출 "기타" 이름 변경은 수입 "기타" 거래/카테고리에 영향 없음
    const etc = find(await listCats(A.api), 'expense', '기타');
    expect((await patchCat(A.api, etc.id, { name: '잡비' })).status()).toBe(200);
    const aOct = await txs(A.api, '2026-10');
    expect(aOct.find((t) => t.amount === 1111).category).toBe('잡비');
    const incTx = aOct.find((t) => t.amount === 2222);
    expect(incTx).toMatchObject({ type: 'income', category: '기타' });
    expect((await listCats(A.api)).income).toContain('기타');
    expect((await txs(B.api, '2026-10')).map((t) => t.category)).toContain('기타');
  });

  test('C-C11 이름 변경 후 즉시 거래 쓰기 경합 없이 일관(병렬 POST 여러 건 + 이름 변경 후 목록에 옛 이름 0건)', async () => {
    const { api } = await createLoggedInUser('cc11r');
    const id = find(await listCats(api), 'expense', '쇼핑').id;
    const posts = Promise.all([1, 2, 3, 4, 5, 6].map((n) => addTx(api, { category: '쇼핑', amount: 1000 * n, date: '2026-10-05' })));
    const ren = patchCat(api, id, { name: '구매' });
    const [ps, rr] = await Promise.all([posts, ren]);
    expect(rr.status()).toBe(200);
    // 각 POST 는 201(이름 변경 전 처리) 또는 400(이름 변경 후 옛 이름) 이어야 하고, 최종 목록에 옛 이름 거래는 없어야 한다.
    for (const p of ps) expect([201, 400]).toContain(p.status());
    const list = await txs(api, '2026-10');
    expect(list.filter((t) => t.category === '쇼핑')).toHaveLength(0);
    expect(list.filter((t) => t.category === '구매')).toHaveLength(ps.filter((p) => p.status() === 201).length);
  });
});

test.describe('C-C12 이름 변경 충돌', () => {
  test('C-C12 활성/비활성과 충돌 409, 자기 자신 공백만 변경 200, 대소문자만 변경 시 거래 문자열도 새 표기', async () => {
    const { api } = await createLoggedInUser('cc12');
    const coffee = await mk(api, 'expense', '커피');
    await setActive(api, 'expense', '교통', false);
    await expectError(await patchCat(api, coffee.id, { name: '식비' }), 409, 'CATEGORY_EXISTS');
    await expectError(await patchCat(api, coffee.id, { name: ' 식비 ' }), 409, 'CATEGORY_EXISTS');
    await expectError(await patchCat(api, coffee.id, { name: '교통' }), 409, 'CATEGORY_EXISTS');
    // 거래가 있는 카테고리가 충돌해도 거래/카테고리 불변
    await addTx(api, { category: '커피', amount: 5000, date: '2026-10-02' });
    await expectError(await patchCat(api, coffee.id, { name: '식비' }), 409, 'CATEGORY_EXISTS');
    expect((await txs(api, '2026-10')).map((t) => t.category)).toEqual(['커피']);
    // 자기 자신과 같은 키 (공백만 다름): 200, 이름은 정규화됨
    const same = await patchCat(api, coffee.id, { name: ' 커피 ' });
    expect(same.status()).toBe(200);
    expect((await same.json()).name).toBe('커피');
    // 다른 유형의 같은 이름은 허용
    expect((await patchCat(api, coffee.id, { name: '급여' })).status()).toBe(200);
    expect((await patchCat(api, coffee.id, { name: '커피' })).status()).toBe(200);
    // 대소문자 변경
    const nf = await mk(api, 'expense', 'netflix');
    await addTx(api, { category: 'netflix', amount: 17000, date: '2026-10-03' });
    const r = await patchCat(api, nf.id, { name: 'Netflix' });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toMatchObject({ name: 'Netflix', usedCount: 1 });
    const cats = (await txs(api, '2026-10')).map((t) => t.category).sort();
    expect(cats).toEqual(['Netflix', '커피']);
  });

  test('C-C12 이름 규칙 위반(PATCH) -> 400', async () => {
    const { api } = await createLoggedInUser('cc12b');
    const id = find(await listCats(api), 'expense', '식비').id;
    for (const name of ['', '   ', '가'.repeat(16), 'a\u0001b', 5, null]) {
      const e = await expectError(await patchCat(api, id, { name }), 400, 'VALIDATION_ERROR');
      expect(e.fields.name).toBeTruthy();
    }
    expect(find(await listCats(api), 'expense', '식비')).toBeTruthy();
  });

  test('C-C12 PATCH 본문 검증: 빈 객체/active 비boolean -> 400, 둘 다 -> 한 트랜잭션, 같은 상태 재요청 200 멱등', async () => {
    const { api } = await createLoggedInUser('cc12c');
    const id = find(await listCats(api), 'expense', '식비').id;
    await expectError(await patchCat(api, id, {}), 400, 'VALIDATION_ERROR');
    await expectError(await patchCat(api, id, { active: 'false' }), 400, 'VALIDATION_ERROR');
    await expectError(await patchCat(api, id, { active: 0 }), 400, 'VALIDATION_ERROR');
    expect((await patchCat(api, id, { active: true })).status()).toBe(200); // 이미 활성 -> 변화 없음
    // 둘 다: 이름 충돌이면 active 변경도 반영되지 않는다
    const e = await expectError(await patchCat(api, id, { name: '교통', active: false }), 409, 'CATEGORY_EXISTS');
    expect(e.code).toBe('CATEGORY_EXISTS');
    expect(find(await listCats(api), 'expense', '식비').active).toBe(true);
    const r = await patchCat(api, id, { name: '밥', active: false });
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ name: '밥', active: false });
    // 비활성 상태에서도 이름 변경 가능
    expect((await patchCat(api, id, { name: '식사' })).status()).toBe(200);
  });
});

test.describe('C-C13 사용 안 함 동작', () => {
  test('C-C13 (a)~(e) 쇼핑 비활성: POST 400, 기존 거래/집계/인사이트 유지, PUT 금액만 200, 다른 거래를 쇼핑으로 400, 쇼핑->식비 200', async () => {
    const { api } = await createLoggedInUser('cc13');
    // R5 용 쇼핑 비교군 5건(중앙값 10,000) + 큰 지출 1건, R4 용 쇼핑 baseline 3개월
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await (await addTx(api, { category: '쇼핑', amount: 10000, memo: `생필${i}`, date: `2026-10-0${i + 1}` })).json()).id);
    const big = await (await addTx(api, { category: '쇼핑', amount: 50000, memo: '큰옷', date: TODAY })).json();
    for (const [i, m] of ['2026-07', '2026-08', '2026-09'].entries()) await addTx(api, { category: '쇼핑', amount: 20000, memo: `기준${i}`, date: `${m}-15` });
    const other = await (await addTx(api, { category: '식비', amount: 3000, memo: '밥', date: '2026-10-06' })).json();
    const insBefore = await (await get(api, `/api/insights?month=2026-10&today=${TODAY}`)).json();
    expect(insBefore.largeExpenses.map((l) => l.memo)).toContain('큰옷');
    const overBefore = insBefore.overspending.find((o) => o.category === '쇼핑');
    expect(overBefore).toBeTruthy();

    await setActive(api, 'expense', '쇼핑', false);
    // (a)
    const e = await expectError(await addTx(api, { category: '쇼핑' }), 400, 'VALIDATION_ERROR');
    expect(e.fields.category).toBe('사용 안 함으로 바꾼 카테고리예요. 다른 카테고리를 골라 주세요.');
    const e2 = await expectError(await addTx(api, { category: '없는카테고리' }), 400, 'VALIDATION_ERROR');
    expect(e2.fields.category).toBe('해당 구분에 없는 카테고리예요.');
    // (b)
    expect((await txs(api, '2026-10')).filter((t) => t.category === '쇼핑')).toHaveLength(6);
    const sum = await (await get(api, '/api/summary?month=2026-10')).json();
    expect(sum.byCategory.find((c) => c.category === '쇼핑').total).toBe(100000);
    const st = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    expect(st.items.find((c) => c.category === '쇼핑')).toBeTruthy();
    const insAfter = await (await get(api, `/api/insights?month=2026-10&today=${TODAY}`)).json();
    expect(insAfter.largeExpenses.map((l) => l.memo)).toContain('큰옷');
    expect(insAfter.overspending.find((o) => o.category === '쇼핑')).toMatchObject({ level: overBefore.level, currentTotal: overBefore.currentTotal, baseline: overBefore.baseline, ratio: overBefore.ratio });
    // (c) 금액만 변경
    const put = (id, over) => json(api, 'PUT', `/api/transactions/${id}`, { type: 'expense', amount: 12345, category: '쇼핑', memo: '수정', date: '2026-10-01', ...over });
    const rc = await put(ids[0], {});
    expect(rc.status(), await rc.text()).toBe(200);
    expect((await rc.json()).amount).toBe(12345);
    // (d) 다른 거래를 쇼핑으로
    const rd = await json(api, 'PUT', `/api/transactions/${other.id}`, { type: 'expense', amount: 3000, category: '쇼핑', memo: '밥', date: '2026-10-06' });
    const ed = await expectError(rd, 400, 'VALIDATION_ERROR');
    expect(ed.fields.category).toBeTruthy();
    // (e) 쇼핑 거래를 활성 식비로
    const re = await put(ids[1], { category: '식비' });
    expect(re.status()).toBe(200);
    expect((await re.json()).category).toBe('식비');
    // 변경 후 다시 쇼핑으로 되돌리기는 이제 신규 선택이라 400
    await expectError(await put(ids[1], { category: '쇼핑' }), 400, 'VALIDATION_ERROR');
    // 유형 변경(지출 쇼핑 -> 수입 쇼핑)은 같은 값이 아니므로 400
    await expectError(await put(ids[2], { type: 'income' }), 400, 'VALIDATION_ERROR');
    expect(big.id).toBeTruthy();
  });

  test('C-C13 PUT 형식 오류 + 카테고리 오류는 형식 오류만, 없는 거래는 404 (검사 순서)', async () => {
    const { api } = await createLoggedInUser('cc13b');
    const tx = await (await addTx(api, { category: '쇼핑', date: '2026-10-02' })).json();
    await setActive(api, 'expense', '쇼핑', false);
    const bad = await json(api, 'PUT', `/api/transactions/${tx.id}`, { type: 'expense', amount: 0, category: '없는것', memo: '', date: '2026-10-02' });
    const e = await expectError(bad, 400, 'VALIDATION_ERROR');
    expect(Object.keys(e.fields)).toEqual(['amount']);
    const nf = await json(api, 'PUT', '/api/transactions/00000000-0000-4000-8000-000000000000', { type: 'expense', amount: 1000, category: '없는것', memo: '', date: '2026-10-02' });
    await expectError(nf, 404, 'NOT_FOUND');
  });

  test('C-C13 목록 밖 문자열(이름 변경으로 비워진 옛 이름)을 가진 거래도 변경 없이 수정 가능?  -> 이름 변경 후엔 옛 이름 거래가 없다', async () => {
    const { api } = await createLoggedInUser('cc13c');
    const tx = await (await addTx(api, { category: '교통', date: '2026-10-02' })).json();
    const id = find(await listCats(api), 'expense', '교통').id;
    await patchCat(api, id, { name: '이동' });
    const got = (await txs(api, '2026-10')).find((t) => t.id === tx.id);
    expect(got.category).toBe('이동');
    const r = await json(api, 'PUT', `/api/transactions/${tx.id}`, { type: 'expense', amount: 2000, category: '이동', memo: '', date: '2026-10-02' });
    expect(r.status()).toBe(200);
  });
});

test.describe('C-C14 마지막 활성', () => {
  for (const [type, defaults] of [['expense', DEFAULT_EXPENSE], ['income', DEFAULT_INCOME]]) {
    test(`C-C14 ${type}: 마지막 활성 하나를 사용 안 함 -> 409 CATEGORY_LAST_ACTIVE, 다른 유형은 영향 없음`, async () => {
      const { api } = await createLoggedInUser('cc14');
      for (const name of defaults.slice(1)) await setActive(api, type, name, false);
      expect((await listCats(api))[type]).toEqual([defaults[0]]);
      const last = find(await listCats(api), type, defaults[0]);
      const e = await expectError(await patchCat(api, last.id, { active: false }), 409, 'CATEGORY_LAST_ACTIVE');
      expect(e.message).toBe('카테고리가 하나는 있어야 해요.');
      expect(find(await listCats(api), type, defaults[0]).active).toBe(true);
      // 이름과 함께 요청해도 전체 롤백
      await expectError(await patchCat(api, last.id, { name: '바꿈', active: false }), 409, 'CATEGORY_LAST_ACTIVE');
      expect(find(await listCats(api), type, defaults[0])).toBeTruthy();
      // 다른 유형은 그대로
      const other = type === 'expense' ? 'income' : 'expense';
      expect((await listCats(api))[other]).toEqual(other === 'expense' ? DEFAULT_EXPENSE : DEFAULT_INCOME);
      // 하나라도 다시 사용하면 마지막 것을 끌 수 있다
      await setActive(api, type, defaults[1], true);
      expect((await patchCat(api, last.id, { active: false })).status()).toBe(200);
    });
  }
});

test.describe('C-C15 상한', () => {
  test('C-C15 지출 활성 30개까지 201, 31번째 409 LIMIT, 30개에서 비활성 다시 사용 409, 수입은 별도 30', async () => {
    const { api } = await createLoggedInUser('cc15');
    await setActive(api, 'expense', '교통', false); // 활성 7
    for (let i = 0; i < 23; i++) await mk(api, 'expense', `지출${i}`); // 30
    expect((await listCats(api)).expense).toHaveLength(30);
    const e = await expectError(await postCat(api, 'expense', '서른하나'), 409, 'CATEGORY_LIMIT');
    expect(e.message).toBe('지출 카테고리는 사용 중인 것이 30개까지예요.');
    const rid = find(await listCats(api), 'expense', '교통').id;
    await expectError(await patchCat(api, rid, { active: true }), 409, 'CATEGORY_LIMIT');
    // 같은 이름 재추가는 LIMIT 보다 INACTIVE 검사가 먼저(api.md: 중복 -> 한도)
    await expectError(await postCat(api, 'expense', '교통'), 409, 'CATEGORY_INACTIVE');
    // 하나 끄면 다시 사용 가능
    await setActive(api, 'expense', '지출0', false);
    expect((await patchCat(api, rid, { active: true })).status()).toBe(200);
    // 수입 쪽은 같은 상한: 4 -> 30
    for (let i = 0; i < 26; i++) await mk(api, 'income', `수입${i}`);
    expect((await listCats(api)).income).toHaveLength(30);
    const ei = await expectError(await postCat(api, 'income', '서른하나'), 409, 'CATEGORY_LIMIT');
    expect(ei.message).toBe('수입 카테고리는 사용 중인 것이 30개까지예요.');
  });

  test('C-C15 사용자 전체 120개 도달 후 추가 -> 409 LIMIT(전체 메시지)', async () => {
    test.setTimeout(120_000);
    const { api } = await createLoggedInUser('cc15b');
    // 기본 12개 + 108개 생성 후 즉시 비활성 (유형별 활성이 30을 넘지 않게)
    for (let i = 0; i < 108; i++) {
      const type = i % 2 === 0 ? 'expense' : 'income';
      const c = await mk(api, type, `예비${i}`);
      const r = await patchCat(api, c.id, { active: false });
      expect(r.status(), await r.text()).toBe(200);
    }
    const b = await listCats(api);
    expect(b.items).toHaveLength(120);
    const e = await expectError(await postCat(api, 'expense', '백스물하나'), 409, 'CATEGORY_LIMIT');
    expect(e.message).toBe('카테고리는 모두 합쳐 120개까지 만들 수 있어요.');
    await expectError(await postCat(api, 'income', '백스물하나'), 409, 'CATEGORY_LIMIT');
    expect((await listCats(api)).items).toHaveLength(120);
    // 비활성 다시 사용은 120 상한과 무관(활성 30 미만이면 OK)
    const inactive = b.items.find((i) => !i.active && i.type === 'expense');
    expect((await patchCat(api, inactive.id, { active: true })).status()).toBe(200);
  });
});

test.describe('C-C16 사용자 격리', () => {
  test('C-C16 B 는 A 의 카테고리를 보지도 바꾸지도 못한다', async () => {
    const A = await createLoggedInUser('cc16a');
    const B = await createLoggedInUser('cc16b');
    const mine = await mk(A.api, 'expense', '반려 동물');
    await addTx(A.api, { category: '반려 동물', amount: 5000, date: '2026-10-02' });
    const bList = await listCats(B.api);
    expect(bList.expense).not.toContain('반려 동물');
    expect(bList.items.map((i) => i.id)).not.toContain(mine.id);
    // PATCH 이름/상태 -> 404, A 데이터 불변
    await expectError(await patchCat(B.api, mine.id, { name: '탈취' }), 404, 'NOT_FOUND');
    await expectError(await patchCat(B.api, mine.id, { active: false }), 404, 'NOT_FOUND');
    await expectError(await patchCat(B.api, 'not-a-uuid', { active: false }), 404, 'NOT_FOUND');
    await expectError(await patchCat(B.api, '00000000-0000-4000-8000-000000000000', { active: false }), 404, 'NOT_FOUND');
    const aItem = find(await listCats(A.api), 'expense', '반려 동물');
    expect(aItem).toMatchObject({ active: true, usedCount: 1, id: mine.id });
    expect((await txs(A.api, '2026-10')).map((t) => t.category)).toEqual(['반려 동물']);
    // B 가 A 의 카테고리 이름으로 거래 POST -> 400 (B 의 목록에 없음)
    const e = await expectError(await addTx(B.api, { category: '반려 동물' }), 400, 'VALIDATION_ERROR');
    expect(e.fields.category).toBe('해당 구분에 없는 카테고리예요.');
    // B 가 같은 이름을 자기 것으로 만드는 것은 허용되고 A 와 독립
    const bMine = await mk(B.api, 'expense', '반려 동물');
    expect(bMine.id).not.toBe(mine.id);
    await patchCat(B.api, bMine.id, { name: '펫' });
    expect((await txs(A.api, '2026-10')).map((t) => t.category)).toEqual(['반려 동물']);
    // 집계 격리
    expect((await stat(B.api, 'categories?from=2026-10&to=2026-10&type=expense')).items).toEqual([]);
  });

  test('C-C16 PATCH 본문의 type/userId/id/sortOrder 는 무시 (유형·소유자 불변)', async () => {
    const A = await createLoggedInUser('cc16c');
    const B = await createLoggedInUser('cc16d');
    const c = await mk(A.api, 'expense', '무시');
    const r = await patchCat(A.api, c.id, { name: '무시2', type: 'income', userId: B.user.id, user_id: B.user.id, id: '00000000-0000-4000-8000-000000000000', sortOrder: 0 });
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ id: c.id, type: 'expense', name: '무시2', sortOrder: 8 });
    expect((await listCats(B.api)).items.some((i) => i.name === '무시2')).toBe(false);
    // type 만 보내면 변경할 것이 없으므로 400
    await expectError(await patchCat(A.api, c.id, { type: 'income' }), 400, 'VALIDATION_ERROR');
  });
});

test.describe('C-C17 보안', () => {
  test('C-C17 Origin 없음/다른 Origin -> 403 CSRF_REJECTED, text/plain -> 415, 쿠키 없음 -> 401, 16KB 초과 -> 413', async () => {
    const { api, account } = await createLoggedInUser('cc17');
    const id = find(await listCats(api), 'expense', '식비').id;
    const state = await api.storageState();
    const noOrigin = await newApi({ withOrigin: false, storageState: state });
    await expectError(await json(noOrigin, 'POST', '/api/categories', { type: 'expense', name: 'x' }), 403, 'CSRF_REJECTED');
    await expectError(await json(noOrigin, 'PATCH', `/api/categories/${id}`, { active: false }), 403, 'CSRF_REJECTED');
    const evil = await newApi({ storageState: state, extraHeaders: { Origin: 'https://evil.example' } });
    await expectError(await json(evil, 'POST', '/api/categories', { type: 'expense', name: 'x' }), 403, 'CSRF_REJECTED');
    await expectError(await json(evil, 'PATCH', `/api/categories/${id}`, { active: false }), 403, 'CSRF_REJECTED');
    await expectError(await api.fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: 'x', failOnStatusCode: false }), 415);
    await expectError(await api.fetch(`/api/categories/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, data: 'x', failOnStatusCode: false }), 415);
    const big = JSON.stringify({ type: 'expense', name: 'x', pad: 'a'.repeat(17000) });
    await expectError(await api.fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: big, failOnStatusCode: false }), 413);
    await expectError(await api.fetch(`/api/categories/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, data: big, failOnStatusCode: false }), 413);
    // 거부된 요청은 아무것도 바꾸지 않았다
    const b = await listCats(api);
    expect(b.items).toHaveLength(12);
    expect(find(b, 'expense', '식비').active).toBe(true);
    expect(account.email).toBeTruthy();
  });

  test('C-C17 쿠키 없음 -> GET/POST/PATCH 모두 401, 잘못된 JSON -> 400 INVALID_JSON', async () => {
    const { api } = await createLoggedInUser('cc17b');
    const id = find(await listCats(api), 'expense', '식비').id;
    const anon = await newApi();
    await expectError(await get(anon, '/api/categories'), 401, 'UNAUTHENTICATED');
    await expectError(await json(anon, 'POST', '/api/categories', { type: 'expense', name: 'x' }), 401);
    await expectError(await json(anon, 'PATCH', `/api/categories/${id}`, { active: false }), 401);
    const bad = await api.fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: '{bad json', failOnStatusCode: false });
    await expectError(bad, 400, 'INVALID_JSON');
    const bad2 = await api.fetch(`/api/categories/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, data: '[1]', failOnStatusCode: false });
    await expectError(bad2, 400, 'INVALID_JSON');
  });

  test('C-C17 DELETE /api/categories/:id -> 405 + Allow: PATCH, 컬렉션 PUT/PATCH/DELETE -> 405 Allow: GET, POST', async () => {
    const { api } = await createLoggedInUser('cc17c');
    const id = find(await listCats(api), 'expense', '식비').id;
    const d = await json(api, 'DELETE', `/api/categories/${id}`);
    await expectError(d, 405, 'METHOD_NOT_ALLOWED');
    expect(d.headers().allow).toBe('PATCH');
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      const r = await json(api, m, '/api/categories', {});
      await expectError(r, 405, 'METHOD_NOT_ALLOWED');
      expect(r.headers().allow).toBe('GET, POST');
    }
    for (const m of ['GET', 'POST', 'PUT']) {
      const r = await json(api, m, `/api/categories/${id}`, {});
      await expectError(r, 405, 'METHOD_NOT_ALLOWED');
    }
    expect(find(await listCats(api), 'expense', '식비')).toBeTruthy();
  });
});

test.describe('C-C18 응답 형식/헤더', () => {
  test('C-C18 오류 응답이 모두 {error:{code,message}}, SQL/스택 없음, 헤더는 다른 API 와 동일', async () => {
    const { api } = await createLoggedInUser('cc18');
    const id = find(await listCats(api), 'expense', '식비').id;
    const cases = [
      [await postCat(api, 'expense', ''), 400],
      [await postCat(api, 'expense', '식비'), 409],
      [await patchCat(api, id, {}), 400],
      [await patchCat(api, 'zzz', { active: false }), 404],
      [await json(api, 'DELETE', `/api/categories/${id}`), 405],
    ];
    for (const [res, status] of cases) {
      await expectError(res, status);
      expect(res.headers()['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers()['cache-control']).toContain('no-store');
      expect(res.headers()['x-content-type-options']).toBe('nosniff');
      expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
    }
    const ok = await postCat(api, 'expense', '헤더');
    expect(ok.status()).toBe(201);
    expect(ok.headers()['content-type']).toBe('application/json; charset=utf-8');
    expect(ok.headers()['cache-control']).toContain('no-store');
    const ref = await get(api, '/api/summary?month=2026-10');
    for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'cache-control']) {
      expect(ok.headers()[h], h).toBe(ref.headers()[h]);
    }
    // 응답 본문에 userId/user_id/name_key 등 내부 필드 없음
    expect(Object.keys(await ok.json()).sort()).toEqual(['active', 'id', 'name', 'sortOrder', 'type', 'usedCount']);
  });
});

test.describe('C-C19 R1 빠른 입력', () => {
  const quick = async (api) => (await (await get(api, `/api/recommendations/quick?type=expense&today=${TODAY}`)).json()).items;
  test('C-C19 3건 그룹 카테고리 사용 안 함 -> 사라짐, 다시 사용 -> 나타남, 이름 변경 -> 새 이름 + count 유지', async () => {
    const { api } = await createLoggedInUser('cc19');
    for (const d of ['2026-10-17', '2026-10-18', '2026-10-19']) await addTx(api, { category: '카페/간식', memo: '아침커피', amount: 4500, date: d });
    for (const d of ['2026-10-17', '2026-10-18', '2026-10-19']) await addTx(api, { category: '식비', memo: '점심', amount: 9000, date: d });
    expect((await quick(api)).map((q) => q.memo).sort()).toEqual(['아침커피', '점심']);
    await setActive(api, 'expense', '카페/간식', false);
    expect((await quick(api)).map((q) => q.memo)).toEqual(['점심']);
    await setActive(api, 'expense', '카페/간식', true);
    expect((await quick(api)).map((q) => q.memo).sort()).toEqual(['아침커피', '점심']);
    const id = find(await listCats(api), 'expense', '카페/간식').id;
    await patchCat(api, id, { name: '커피' });
    const q = (await quick(api)).find((x) => x.memo === '아침커피');
    expect(q).toMatchObject({ category: '커피', count: 3, amount: 4500 });
  });

  test('C-C19 같은 메모를 활성 카테고리로 3건 이상 쓰면 비활성 카테고리 그룹은 빠지고 활성 쪽은 제안, 제외 후 5개 채움', async () => {
    const { api } = await createLoggedInUser('cc19b');
    for (const d of ['2026-10-17', '2026-10-18', '2026-10-19']) await addTx(api, { category: '쇼핑', memo: '공통', amount: 1000, date: d });
    for (const d of ['2026-10-14', '2026-10-15', '2026-10-16']) await addTx(api, { category: '식비', memo: '공통', amount: 2000, date: d });
    for (let k = 0; k < 6; k++) for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) await addTx(api, { category: '교통', memo: `교통${k}`, amount: 1000, date: d });
    await setActive(api, 'expense', '쇼핑', false);
    const items = await quick(api);
    expect(items.every((q) => q.category !== '쇼핑')).toBe(true);
    expect(items.find((q) => q.memo === '공통')).toMatchObject({ category: '식비', count: 3 });
    expect(items).toHaveLength(5);
  });
});

test.describe('C-C20 R2 자동완성', () => {
  const auto = async (api, q) => (await (await get(api, `/api/recommendations/autocomplete?q=${encodeURIComponent(q)}&type=expense&today=${TODAY}`)).json()).items;
  test('C-C20 점심: 식비3·쇼핑1 -> 식비 비활성 -> 쇼핑 -> 쇼핑도 비활성 -> category null, memo/amount 유지', async () => {
    const { api } = await createLoggedInUser('cc20');
    for (const d of ['2026-10-14', '2026-10-15', '2026-10-16']) await addTx(api, { category: '식비', memo: '점심', amount: 9000, date: d });
    await addTx(api, { category: '쇼핑', memo: '점심', amount: 9000, date: '2026-10-17' });
    expect(await auto(api, '점심')).toEqual([{ memo: '점심', category: '식비', amount: 9000 }]);
    await setActive(api, 'expense', '식비', false);
    expect((await auto(api, '점심'))[0]).toMatchObject({ memo: '점심', category: '쇼핑', amount: 9000 });
    await setActive(api, 'expense', '쇼핑', false);
    const r = await auto(api, '점심');
    expect(r).toEqual([{ memo: '점심', category: null, amount: 9000 }]);
    await setActive(api, 'expense', '식비', true);
    expect((await auto(api, '점심'))[0].category).toBe('식비');
  });

  test('C-C20 동률이면 가장 최근 사용한 활성 카테고리', async () => {
    const { api } = await createLoggedInUser('cc20b');
    await addTx(api, { category: '식비', memo: '간식', amount: 3000, date: '2026-10-10' });
    await addTx(api, { category: '쇼핑', memo: '간식', amount: 3000, date: '2026-10-12' });
    expect((await auto(api, '간식'))[0].category).toBe('쇼핑');
  });
});

test.describe('C-C21 R4/R5 연속성', () => {
  async function setup(tag) {
    const { api } = await createLoggedInUser(tag);
    for (const [i, m] of ['2026-07', '2026-08', '2026-09'].entries()) await addTx(api, { category: '식비', amount: 100000, memo: `기준${i}`, date: `${m}-15` });
    await addTx(api, { category: '식비', amount: 130000, memo: '외식', date: '2026-10-05' });
    for (let i = 0; i < 5; i++) await addTx(api, { category: '식비', amount: 10000, memo: `비교${i}`, date: `2026-10-0${i + 1}`.replace('2026-10-01', '2026-10-01') });
    await addTx(api, { category: '식비', amount: 90000, memo: '큰식사', date: TODAY });
    return api;
  }
  const ins = async (api) => (await get(api, `/api/insights?month=2026-10&today=${TODAY}`)).json();
  test('C-C21 R4 exceeded / R5 큰 지출: 이름 변경 후 새 이름으로 같은 수치, 비활성이어도 유지', async () => {
    const api = await setup('cc21');
    const b = await ins(api);
    const o = b.overspending.find((x) => x.category === '식비');
    expect(o?.level).toBe('exceeded');
    const big = b.largeExpenses.find((x) => x.memo === '큰식사');
    expect(big).toBeTruthy();
    const id = find(await listCats(api), 'expense', '식비').id;
    expect((await patchCat(api, id, { name: '밥값' })).status()).toBe(200);
    const a = await ins(api);
    expect(a.overspending.find((x) => x.category === '식비')).toBeUndefined();
    const o2 = a.overspending.find((x) => x.category === '밥값');
    expect(o2).toMatchObject({ level: o.level, currentTotal: o.currentTotal, baseline: o.baseline, ratio: o.ratio, projectedTotal: o.projectedTotal });
    const big2 = a.largeExpenses.find((x) => x.memo === '큰식사');
    expect(big2).toMatchObject({ category: '밥값', median: big.median, multiple: big.multiple, amount: big.amount });
    expect(a.largeExpenses.map((x) => x.category)).not.toContain('식비');
    await setActive(api, 'expense', '밥값', false);
    const c = await ins(api);
    expect(c.overspending.find((x) => x.category === '밥값')).toMatchObject({ level: o.level, currentTotal: o.currentTotal, baseline: o.baseline, ratio: o.ratio });
    expect(c.largeExpenses.find((x) => x.memo === '큰식사')).toMatchObject({ median: big.median, multiple: big.multiple });
  });

  test('C-C21 R3 반복(메모 있음/없음)도 이름 변경 후 이어진다', async () => {
    const { api } = await createLoggedInUser('cc21b');
    for (const d of ['2026-07-24', '2026-08-23', '2026-09-22']) await addTx(api, { category: '문화/여가', memo: '구독', amount: 9900, date: d });
    for (const d of ['2026-07-26', '2026-08-25', '2026-09-24']) await addTx(api, { category: '주거/통신', memo: '', amount: 55000, date: d });
    const before = (await ins(api)).recurring;
    expect(before).toHaveLength(2);
    await patchCat(api, find(await listCats(api), 'expense', '문화/여가').id, { name: '취미' });
    await patchCat(api, find(await listCats(api), 'expense', '주거/통신').id, { name: '고정비' });
    const after = (await ins(api)).recurring;
    expect(after).toHaveLength(2);
    const norm = (r) => r.map((x) => ({ ...x, category: undefined })).sort((a, b) => a.amount - b.amount);
    expect(norm(after)).toEqual(norm(before));
    expect(after.map((x) => x.category).sort()).toEqual(['고정비', '취미']);
  });
});

test.describe('C-C22 동률 정렬', () => {
  test('C-C22 total 동률 시 sortOrder 순 (기본 세트=기존 순서, 새 카테고리는 뒤), 이름 변경해도 sortOrder 유지', async () => {
    const { api } = await createLoggedInUser('cc22');
    await mk(api, 'expense', '가나다');
    for (const c of ['가나다', '기타', '식비', '의료/건강', '쇼핑']) await addTx(api, { category: c, amount: 5000, date: '2026-10-02' });
    const order = ['식비', '쇼핑', '의료/건강', '기타', '가나다'];
    const st = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    expect(st.items.map((i) => i.category)).toEqual(order);
    const sum = await (await get(api, '/api/summary?month=2026-10')).json();
    expect(sum.byCategory.map((i) => i.category)).toEqual(order);
    const cm = await stat(api, 'category-monthly?from=2026-10&to=2026-10&type=expense');
    expect(cm.series.map((s) => s.category)).toEqual(order);
    // 식비 이름 변경해도 순서(sortOrder) 유지, 순서 바꾸기 없음
    await patchCat(api, find(await listCats(api), 'expense', '식비').id, { name: 'zz밥' });
    const st2 = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    expect(st2.items.map((i) => i.category)).toEqual(['zz밥', '쇼핑', '의료/건강', '기타', '가나다']);
    // 사용 안 함이어도 sortOrder 기준 유지
    await setActive(api, 'expense', '쇼핑', false);
    const st3 = await stat(api, 'categories?from=2026-10&to=2026-10&type=expense');
    expect(st3.items.map((i) => i.category)).toEqual(['zz밥', '쇼핑', '의료/건강', '기타', '가나다']);
  });
});

test.describe('가입/거래 보조 동작', () => {
  test('수입 카테고리 이름 변경이 수입 거래/통계에만 반영, 거래 POST 는 type 별 활성 목록으로 검증', async () => {
    const { api } = await createLoggedInUser('inc');
    await addTx(api, { type: 'income', category: '급여', amount: 2000000, date: '2026-10-25' });
    await addTx(api, { type: 'income', category: '용돈', amount: 50000, date: '2026-10-26' });
    const id = find(await listCats(api), 'income', '급여').id;
    expect((await patchCat(api, id, { name: '월급' })).status()).toBe(200);
    const st = await stat(api, 'categories?from=2026-10&to=2026-10&type=income');
    expect(st.items.map((i) => i.category)).toEqual(['월급', '용돈']);
    // 수입에 지출 카테고리 -> 400
    await expectError(await addTx(api, { type: 'income', category: '식비' }), 400, 'VALIDATION_ERROR');
    // 수입 사용 안 함
    await setActive(api, 'income', '용돈', false);
    await expectError(await addTx(api, { type: 'income', category: '용돈' }), 400, 'VALIDATION_ERROR');
    expect((await addTx(api, { type: 'income', category: '월급', amount: 10 })).status()).toBe(201);
  });
});
