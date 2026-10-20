// 카테고리 관리 API(v3) 통합 테스트 - PGlite 메모리 DB + 실제 HTTP 서버
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';
import { buildSeedTransactions } from '../scripts/seed.js';
import { DEFAULT_CATEGORIES } from '../lib/categories.js';

let app;
before(async () => {
  app = await startApp({}, { now: () => new Date('2026-10-18T16:00:00Z') }); // KST 2026-10-19
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from transactions; delete from auth_attempts; delete from sessions; delete from users;');
});

async function newUser(email) {
  const r = await app.request('POST', '/api/auth/signup', { body: { email, password: GOOD_PASSWORD } });
  assert.equal(r.status, 201);
  return { cookie: cookieFrom(r), id: r.json.user.id };
}
const A = () => newUser('a@example.com');
const B = () => newUser('b@example.com');
const tx = (o = {}) => ({ type: 'expense', amount: 4500, category: '카페/간식', memo: '스타벅스', date: '2026-10-19', ...o });
const postTx = (u, body) => app.request('POST', '/api/transactions', { body, cookie: u.cookie });
const putTx = (u, id, body) => app.request('PUT', `/api/transactions/${id}`, { body, cookie: u.cookie });
const get = (u, path) => app.request('GET', path, { cookie: u.cookie });
const addCat = (u, type, name) => app.request('POST', '/api/categories', { body: { type, name }, cookie: u.cookie });
const patchCat = (u, id, body) => app.request('PATCH', `/api/categories/${id}`, { body, cookie: u.cookie });
const items = async (u) => (await get(u, '/api/categories')).json.items;
const find = async (u, type, name) => (await items(u)).find((i) => i.type === type && i.name === name);
const errCode = (r) => r.json?.error?.code;

test('C-C6 가입 직후: 기본 세트 12행, expense/income 은 기존 목록과 같고 items 모두 active', async () => {
  const u = await A();
  const r = await get(u, '/api/categories');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.expense, DEFAULT_CATEGORIES.expense);
  assert.deepEqual(r.json.income, DEFAULT_CATEGORIES.income);
  assert.equal(r.json.items.length, 12);
  assert.ok(r.json.items.every((i) => i.active === true && i.usedCount === 0));
  assert.deepEqual(Object.keys(r.json.items[0]).sort(), ['active', 'id', 'name', 'sortOrder', 'type', 'usedCount']);
  assert.deepEqual(r.json.items.map((i) => i.type), [...Array(8).fill('expense'), ...Array(4).fill('income')]);
  assert.equal((await app.db.query('select count(*)::int n from categories where user_id = $1', [u.id])).rows[0].n, 12);
});

test('C-C5 행이 없는 사용자: 동시 GET 5회 모두 200, 행은 정확히 12개', async () => {
  const u = await A();
  await app.db.query('delete from categories where user_id = $1', [u.id]); // 구버전 코드로 가입한 상황
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => get(u, '/api/categories')));
  assert.ok(rs.every((r) => r.status === 200 && r.json.items.length === 12));
  assert.equal((await app.db.query('select count(*)::int n from categories where user_id = $1', [u.id])).rows[0].n, 12);
});

test('지연 생성: 행이 없는 사용자의 거래 POST 도 기본 카테고리로 통과한다', async () => {
  const u = await A();
  await app.db.query('delete from categories where user_id = $1', [u.id]);
  assert.equal((await postTx(u, tx())).status, 201);
  assert.equal((await postTx(u, tx({ category: '없는것' }))).status, 400);
  assert.equal((await app.db.query('select count(*)::int n from categories where user_id = $1', [u.id])).rows[0].n, 12);
});

test('C-C7 추가: 정규화된 이름, 지출 맨 끝, 이후 expense 배열 맨 끝', async () => {
  const u = await A();
  const r = await addCat(u, 'expense', '  반려   동물 ');
  assert.equal(r.status, 201);
  assert.equal(r.json.name, '반려 동물');
  assert.equal(r.json.type, 'expense');
  assert.equal(r.json.active, true);
  assert.equal(r.json.sortOrder, 8);
  assert.equal(r.json.usedCount, 0);
  const list = (await get(u, '/api/categories')).json;
  assert.equal(list.expense.at(-1), '반려 동물');
  assert.equal(list.income.length, 4);
  const inc = await addCat(u, 'income', '이자');
  assert.equal(inc.json.sortOrder, 4);
});

test('C-C8 이름 검증', async () => {
  const u = await A();
  const bad = [
    { type: 'expense', name: '' }, { type: 'expense', name: '   ' }, { type: 'expense', name: '가'.repeat(16) },
    { type: 'expense', name: 'a\u0000b' }, { type: 'expense', name: 'a\u007fb' }, { type: 'expense', name: 'a\u0007b' },
    { type: 'expense', name: 123 }, { type: 'expense', name: null }, { type: 'expense' }, { type: 'transfer', name: '가' }, { name: '가' },
  ];
  for (const body of bad) {
    const r = await app.request('POST', '/api/categories', { body, cookie: u.cookie });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(errCode(r), 'VALIDATION_ERROR');
    assert.ok(r.json.error.fields, JSON.stringify(body));
  }
  const ok15 = await addCat(u, 'expense', '가'.repeat(15));
  assert.equal(ok15.status, 201);
  const html = await addCat(u, 'expense', '<b onclick=x>');
  assert.equal(html.status, 201);
  assert.equal(html.json.name, '<b onclick=x>');
  // 이모지는 코드포인트 1자
  assert.equal((await addCat(u, 'expense', '🐶'.repeat(15))).status, 201);
  assert.equal((await addCat(u, 'expense', '🐱'.repeat(16))).status, 400);
  // 탭·줄바꿈은 공백 1칸으로
  assert.equal((await addCat(u, 'income', '이자\t\n배당')).json.name, '이자 배당');
});

test('C-C9 중복: 정규화 키, 다른 유형은 허용', async () => {
  const u = await A();
  for (const name of ['식비', ' 식비 ']) {
    const r = await addCat(u, 'expense', name);
    assert.equal(r.status, 409);
    assert.equal(errCode(r), 'CATEGORY_EXISTS');
  }
  assert.equal((await addCat(u, 'expense', 'Netflix')).status, 201);
  assert.equal(errCode(await addCat(u, 'expense', 'netflix')), 'CATEGORY_EXISTS');
  assert.equal(errCode(await addCat(u, 'expense', ' NETFLIX ')), 'CATEGORY_EXISTS');
  assert.equal((await addCat(u, 'income', '식비')).status, 201);
});

test('C-C10 사용 안 함 이름 재추가는 409 CATEGORY_INACTIVE + categoryId, 복구하면 원래 순서', async () => {
  const u = await A();
  const traffic = await find(u, 'expense', '교통');
  await postTx(u, tx({ category: '교통', memo: '버스' }));
  assert.equal((await patchCat(u, traffic.id, { active: false })).status, 200);
  const r = await addCat(u, 'expense', '교통');
  assert.equal(r.status, 409);
  assert.equal(errCode(r), 'CATEGORY_INACTIVE');
  assert.equal(r.json.error.categoryId, traffic.id);
  assert.deepEqual(Object.keys(r.json.error).sort(), ['categoryId', 'code', 'message']);
  const back = await patchCat(u, r.json.error.categoryId, { active: true });
  assert.equal(back.status, 200);
  assert.equal(back.json.active, true);
  assert.equal(back.json.sortOrder, traffic.sortOrder);
  const stats = await get(u, '/api/stats/categories?from=2026-10&to=2026-10');
  assert.equal(stats.json.items.find((i) => i.category === '교통').count, 1);
});

test('C-C11 이름 변경: 과거 거래·집계 모두 새 이름, 다른 사용자·다른 유형의 같은 이름은 그대로', async () => {
  const a = await A();
  const b = await B();
  const dates = ['2026-08-03', '2026-08-20', '2026-09-05', '2026-10-01', '2026-10-19'];
  for (const [i, date] of dates.entries()) await postTx(a, tx({ amount: 1000 * (i + 1), date }));
  await postTx(b, tx({ amount: 777, date: '2026-10-02' }));
  await postTx(a, tx({ type: 'expense', category: '기타', amount: 300, memo: '', date: '2026-10-03' }));
  await postTx(a, tx({ type: 'income', category: '기타', amount: 900, memo: '', date: '2026-10-03' }));
  const beforeCat = (await get(a, '/api/stats/categories?from=2026-08&to=2026-10')).json.items.find((i) => i.category === '카페/간식');
  const cafe = await find(a, 'expense', '카페/간식');
  assert.equal(cafe.usedCount, 5);

  const r = await patchCat(a, cafe.id, { name: '커피' });
  assert.equal(r.status, 200);
  assert.equal(r.json.name, '커피');
  assert.equal(r.json.usedCount, 5);

  for (const month of ['2026-08', '2026-09', '2026-10']) {
    const list = (await get(a, `/api/transactions?month=${month}`)).json.transactions;
    assert.ok(!list.some((t) => t.category === '카페/간식'), month);
  }
  const after = (await get(a, '/api/stats/categories?from=2026-08&to=2026-10')).json;
  assert.ok(!after.items.some((i) => i.category === '카페/간식'));
  const coffee = after.items.find((i) => i.category === '커피');
  assert.equal(coffee.total, beforeCat.total);
  assert.equal(coffee.count, beforeCat.count);
  const cm = (await get(a, '/api/stats/category-monthly?from=2026-08&to=2026-10')).json;
  assert.ok(!cm.series.some((s) => s.category === '카페/간식'));
  assert.equal(cm.series.find((s) => s.category === '커피').sum, beforeCat.total);
  const sum = (await get(a, '/api/summary?month=2026-10')).json;
  assert.ok(sum.byCategory.some((c) => c.category === '커피') && !sum.byCategory.some((c) => c.category === '카페/간식'));

  // 다른 사용자는 그대로
  const bList = (await get(b, '/api/transactions?month=2026-10')).json.transactions;
  assert.equal(bList[0].category, '카페/간식');
  assert.equal((await find(b, 'expense', '카페/간식')).usedCount, 1);

  // 지출 "기타" 이름 변경은 수입 "기타" 거래를 건드리지 않는다
  const etc = await find(a, 'expense', '기타');
  assert.equal((await patchCat(a, etc.id, { name: '잡비' })).status, 200);
  const oct = (await get(a, '/api/transactions?month=2026-10')).json.transactions;
  assert.equal(oct.find((t) => t.type === 'expense' && t.amount === 300).category, '잡비');
  assert.equal(oct.find((t) => t.type === 'income').category, '기타');
});

test('C-C12 이름 변경 충돌과 같은 키 변경', async () => {
  const u = await A();
  const cafe = await find(u, 'expense', '카페/간식');
  const traffic = await find(u, 'expense', '교통');
  await patchCat(u, traffic.id, { active: false });
  assert.equal(errCode(await patchCat(u, cafe.id, { name: '식비' })), 'CATEGORY_EXISTS');
  assert.equal(errCode(await patchCat(u, cafe.id, { name: '교통' })), 'CATEGORY_EXISTS'); // 비활성과도 충돌
  assert.equal(errCode(await patchCat(u, cafe.id, { name: ' 식비 ' })), 'CATEGORY_EXISTS');
  assert.equal((await patchCat(u, cafe.id, { name: '수입과같음' })).status, 200);
  assert.equal((await patchCat(u, cafe.id, { name: '급여' })).status, 200); // 다른 유형의 이름은 허용
  // 정규화 결과가 같으면 변화 없음
  assert.equal((await patchCat(u, cafe.id, { name: ' 급여 ' })).json.name, '급여');
  // 대소문자만 변경은 허용하고 거래 문자열도 새 표기
  const n = (await addCat(u, 'expense', 'netflix')).json;
  await postTx(u, tx({ category: 'netflix', memo: 'n' }));
  const r = await patchCat(u, n.id, { name: 'Netflix' });
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Netflix');
  assert.equal((await get(u, '/api/transactions?month=2026-10')).json.transactions[0].category, 'Netflix');
  // 실패한 변경은 아무것도 바꾸지 않는다
  assert.equal((await find(u, 'expense', '식비')).usedCount, 0);
});

test('C-C13 사용 안 함: 새 선택 거부, 기존 거래·집계 유지, PUT 은 유지만 허용', async () => {
  const u = await A();
  const old = (await postTx(u, tx({ category: '쇼핑', memo: '옷', amount: 30000 }))).json;
  const other = (await postTx(u, tx({ category: '식비', memo: '밥', amount: 8000 }))).json;
  const shop = await find(u, 'expense', '쇼핑');
  assert.equal((await patchCat(u, shop.id, { active: false })).json.active, false);

  const list = (await get(u, '/api/categories')).json;
  assert.ok(!list.expense.includes('쇼핑'));
  assert.ok(list.items.some((i) => i.name === '쇼핑' && !i.active && i.usedCount === 1));

  const p = await postTx(u, tx({ category: '쇼핑' }));
  assert.equal(p.status, 400);
  assert.equal(p.json.error.fields.category, '사용 안 함으로 바꾼 카테고리예요. 다른 카테고리를 골라 주세요.');
  const unknown = await postTx(u, tx({ category: '없는것' }));
  assert.equal(unknown.json.error.fields.category, '해당 구분에 없는 카테고리예요.');

  assert.ok((await get(u, '/api/transactions?month=2026-10')).json.transactions.some((t) => t.id === old.id));
  assert.equal((await get(u, '/api/summary?month=2026-10')).json.byCategory.find((c) => c.category === '쇼핑').total, 30000);
  assert.ok((await get(u, '/api/stats/categories?from=2026-10&to=2026-10')).json.items.some((i) => i.category === '쇼핑'));

  assert.equal((await putTx(u, old.id, tx({ category: '쇼핑', memo: '옷', amount: 35000 }))).json.amount, 35000); // c
  const d = await putTx(u, other.id, tx({ category: '쇼핑', memo: '밥', amount: 8000 })); // d
  assert.equal(d.status, 400);
  assert.equal(d.json.error.fields.category, '사용 안 함으로 바꾼 카테고리예요. 다른 카테고리를 골라 주세요.');
  const e = await putTx(u, old.id, tx({ category: '식비', memo: '옷', amount: 35000 })); // e
  assert.equal(e.status, 200);
  assert.equal(e.json.category, '식비');
  // 유지 예외는 type 이 같을 때만: 수입으로 바꾸면서 "쇼핑" 이름을 쓰면 수입에 없는 이름이라 400
  const f = await putTx(u, other.id, tx({ type: 'income', category: '쇼핑' }));
  assert.equal(f.status, 400);
});

test('PUT: 존재하지 않는 거래에 잘못된 카테고리를 보내면 404, 형식 오류가 있으면 400 하나', async () => {
  const u = await A();
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await putTx(u, missing, tx({ category: '없는것' }))).status, 404);
  const t = (await postTx(u, tx())).json;
  const r = await putTx(u, t.id, tx({ category: '없는것', amount: 0 }));
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.json.error.fields), ['amount']);
});

test('C-C14 마지막 활성 카테고리는 사용 안 함 불가 (지출·수입)', async () => {
  const u = await A();
  for (const type of ['expense', 'income']) {
    const all = (await items(u)).filter((i) => i.type === type);
    for (const c of all.slice(0, -1)) assert.equal((await patchCat(u, c.id, { active: false })).status, 200);
    const last = all.at(-1);
    const r = await patchCat(u, last.id, { active: false });
    assert.equal(r.status, 409);
    assert.equal(errCode(r), 'CATEGORY_LAST_ACTIVE');
    assert.equal(r.json.error.message, '카테고리가 하나는 있어야 해요.');
    assert.equal((await find(u, type, last.name)).active, true);
  }
});

test('C-C15 상한: 유형별 활성 30, 다시 사용도 30 초과 불가, 전체 120', async () => {
  const u = await A();
  for (let i = 0; i < 22; i++) assert.equal((await addCat(u, 'expense', `지출${i}`)).status, 201); // 8 + 22 = 30
  const r = await addCat(u, 'expense', '지출넘침');
  assert.equal(r.status, 409);
  assert.equal(errCode(r), 'CATEGORY_LIMIT');
  assert.match(r.json.error.message, /지출.*30/);
  // 수입은 별개로 30까지
  for (let i = 0; i < 26; i++) assert.equal((await addCat(u, 'income', `수입${i}`)).status, 201);
  assert.equal(errCode(await addCat(u, 'income', '수입넘침')), 'CATEGORY_LIMIT');
  // 하나 비활성 -> 하나 추가 -> 기존 비활성은 다시 사용 불가
  const first = await find(u, 'expense', '식비');
  await patchCat(u, first.id, { active: false });
  assert.equal((await addCat(u, 'expense', '새지출')).status, 201);
  const re = await patchCat(u, first.id, { active: true });
  assert.equal(re.status, 409);
  assert.equal(errCode(re), 'CATEGORY_LIMIT');
  assert.equal((await find(u, 'expense', '식비')).active, false);
  // 이미 활성인 것을 active:true 로 보내는 멱등 요청은 한도와 무관하게 200
  const other = await find(u, 'expense', '교통');
  assert.equal((await patchCat(u, other.id, { active: true })).status, 200);
});

test('C-C15 사용자 전체 120개 상한', async () => {
  const u = await A();
  // 활성 30 + 비활성으로 돌려 가며 120 채우기: 지출/수입 번갈아 만들고 비활성화
  let n = (await items(u)).length;
  let i = 0;
  while (n < 120) {
    const type = i % 2 ? 'income' : 'expense';
    const r = await addCat(u, type, `채움${i}`);
    assert.equal(r.status, 201, `n=${n} ${r.text}`);
    await patchCat(u, r.json.id, { active: false });
    n += 1;
    i += 1;
  }
  const r = await addCat(u, 'expense', '백이십일');
  assert.equal(r.status, 409);
  assert.equal(errCode(r), 'CATEGORY_LIMIT');
  assert.equal(r.json.error.message, '카테고리는 모두 합쳐 120개까지 만들 수 있어요.');
});

test('C-C16 사용자 격리', async () => {
  const a = await A();
  const b = await B();
  const mine = (await addCat(a, 'expense', '반려 동물')).json;
  assert.ok(!(await items(b)).some((i) => i.name === '반려 동물'));
  const r = await patchCat(b, mine.id, { name: '탈취', active: false });
  assert.equal(r.status, 404);
  assert.equal(errCode(r), 'NOT_FOUND');
  const still = await find(a, 'expense', '반려 동물');
  assert.equal(still.active, true);
  assert.equal(await patchCat(a, 'not-a-uuid', { active: false }).then((x) => x.status), 404);
  assert.equal(await patchCat(a, '00000000-0000-4000-8000-000000000000', { active: false }).then((x) => x.status), 404);
  assert.equal((await postTx(b, tx({ category: '반려 동물' }))).status, 400);
  assert.equal((await postTx(a, tx({ category: '반려 동물' }))).status, 201);
  // B 의 거래 수정으로 A 의 카테고리에 접근 불가
  const bt = (await postTx(b, tx())).json;
  assert.equal((await putTx(b, bt.id, tx({ category: '반려 동물' }))).status, 400);
});

test('C-C17 보안: Origin/Content-Type/크기/401/405, PATCH 의 type·userId 무시', async () => {
  const u = await A();
  const cat = await find(u, 'expense', '식비');
  const o = { body: { type: 'expense', name: '가' }, cookie: u.cookie };
  assert.equal((await app.request('POST', '/api/categories', { ...o, origin: null })).status, 403);
  assert.equal((await app.request('POST', '/api/categories', { ...o, origin: 'http://evil.example' })).status, 403);
  assert.equal((await app.request('PATCH', `/api/categories/${cat.id}`, { body: { active: false }, cookie: u.cookie, origin: null })).status, 403);
  assert.equal(
    (await app.request('PATCH', `/api/categories/${cat.id}`, { body: { active: false }, cookie: u.cookie, origin: 'http://evil.example' })).status,
    403,
  );
  const ct = await app.request('POST', '/api/categories', { raw: '{"type":"expense","name":"가"}', headers: { 'Content-Type': 'text/plain' }, cookie: u.cookie });
  assert.equal(ct.status, 415);
  const big = await app.request('POST', '/api/categories', { raw: JSON.stringify({ type: 'expense', name: 'x'.repeat(20000) }), cookie: u.cookie });
  assert.equal(big.status, 413);
  assert.equal((await app.request('POST', '/api/categories', { raw: '{"type":', cookie: u.cookie })).json.error.code, 'INVALID_JSON');
  for (const [m, p, b] of [['GET', '/api/categories'], ['POST', '/api/categories', { type: 'expense', name: '가' }], ['PATCH', `/api/categories/${cat.id}`, { active: false }]]) {
    const r = await app.request(m, p, { body: b });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  const del = await app.request('DELETE', `/api/categories/${cat.id}`, { cookie: u.cookie });
  assert.equal(del.status, 405);
  assert.equal(del.headers.allow, 'PATCH');
  assert.equal(errCode(del), 'METHOD_NOT_ALLOWED');
  const coll = await app.request('DELETE', '/api/categories', { cookie: u.cookie });
  assert.equal(coll.status, 405);
  assert.equal(coll.headers.allow, 'GET, POST');
  assert.equal((await app.request('PUT', `/api/categories/${cat.id}`, { body: { name: '가' }, cookie: u.cookie })).status, 405);

  // type/userId/id/sortOrder 는 무시: 이름만 바뀐다
  const b = await B();
  const r = await patchCat(u, cat.id, { name: '밥', type: 'income', userId: b.id, user_id: b.id, id: 'x', sortOrder: 99 });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, 'expense');
  assert.equal(r.json.id, cat.id);
  assert.equal(r.json.sortOrder, cat.sortOrder);
  assert.equal((await app.db.query('select user_id from categories where id = $1', [cat.id])).rows[0].user_id, u.id);
});

test('PATCH 검증: 필드 없음/타입 오류는 400, 검사 순서(400 이 404 보다 먼저)', async () => {
  const u = await A();
  const cat = await find(u, 'expense', '식비');
  const none = await patchCat(u, cat.id, {});
  assert.equal(none.status, 400);
  assert.equal(none.json.error.message, 'name 또는 active 중 하나는 보내 주세요.');
  assert.equal(none.json.error.fields, undefined);
  for (const body of [{ active: 'true' }, { active: 1 }, { active: null }, { name: null }, { name: '' }, { name: 5 }, { name: '가'.repeat(16) }]) {
    const r = await patchCat(u, cat.id, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.json.error.fields);
  }
  assert.equal((await patchCat(u, 'zzz', {})).status, 400);
  // 이름+상태를 같이 보냈고 한쪽이 실패하면 둘 다 반영되지 않는다
  const other = await find(u, 'expense', '교통');
  await patchCat(u, other.id, { active: false });
  const incomeAll = (await items(u)).filter((i) => i.type === 'income');
  for (const c of incomeAll.slice(0, -1)) await patchCat(u, c.id, { active: false });
  const last = incomeAll.at(-1);
  const both = await patchCat(u, last.id, { name: '새이름', active: false });
  assert.equal(errCode(both), 'CATEGORY_LAST_ACTIVE');
  assert.equal((await find(u, 'income', last.name))?.active, true, '이름 변경도 롤백');
  assert.equal(await find(u, 'income', '새이름'), undefined);
  // 이미 같은 상태는 200 (LAST_ACTIVE/LIMIT 검사 안 함)
  assert.equal((await patchCat(u, other.id, { active: false })).status, 200);
  assert.equal((await patchCat(u, last.id, { active: true })).status, 200);
});

test('C-C19 R1: 비활성이면 제안에서 빠지고 복구하면 다시 나타남, 이름 변경은 count 유지', async () => {
  const u = await A();
  const today = '2026-10-19';
  for (const date of ['2026-10-10', '2026-10-12', '2026-10-15']) await postTx(u, tx({ date, amount: 4500 }));
  const quick = async () => (await get(u, `/api/recommendations/quick?today=${today}`)).json.items;
  assert.equal((await quick()).length, 1);
  const cafe = await find(u, 'expense', '카페/간식');
  await patchCat(u, cafe.id, { active: false });
  assert.deepEqual(await quick(), []);
  await patchCat(u, cafe.id, { active: true });
  assert.equal((await quick()).length, 1);
  await patchCat(u, cafe.id, { name: '커피' });
  const q = await quick();
  assert.equal(q[0].category, '커피');
  assert.equal(q[0].count, 3);
  // 같은 메모를 활성 다른 카테고리로 3건 이상 쓴 그룹은 비활성과 별개로 제안된다
  for (const date of ['2026-10-16', '2026-10-17', '2026-10-18']) await postTx(u, tx({ category: '식비', date }));
  await patchCat(u, cafe.id, { active: false });
  const q2 = await quick();
  assert.equal(q2.length, 1);
  assert.equal(q2[0].category, '식비');
});

test('C-C20 R2: 활성 최다 카테고리, 모두 비활성이면 category null (메모·금액은 제안)', async () => {
  const u = await A();
  const today = '2026-10-19';
  for (const date of ['2026-10-10', '2026-10-11', '2026-10-12']) await postTx(u, tx({ category: '식비', memo: '점심', date, amount: 9000 }));
  await postTx(u, tx({ category: '쇼핑', memo: '점심', date: '2026-10-13', amount: 9000 }));
  const ac = async () => (await get(u, `/api/recommendations/autocomplete?q=${encodeURIComponent('점')}&today=${today}`)).json.items;
  assert.equal((await ac())[0].category, '식비');
  await patchCat(u, (await find(u, 'expense', '식비')).id, { active: false });
  assert.equal((await ac())[0].category, '쇼핑');
  await patchCat(u, (await find(u, 'expense', '쇼핑')).id, { active: false });
  const r = await ac();
  assert.equal(r[0].category, null);
  assert.equal(r[0].memo, '점심');
  assert.equal(r[0].amount, 9000);
});

test('C-C21 R4/R5: 이름 변경 후에도 같은 값, 비활성이어도 항목 유지', async () => {
  const u = await A();
  const today = '2026-10-19';
  for (const t of buildSeedTransactions(today)) {
    await app.db.query('insert into transactions (user_id, type, amount, category, memo, date) values ($1,$2,$3,$4,$5,$6::date)', [u.id, t.type, t.amount, t.category, t.memo, t.date]);
  }
  const ins = async () => (await get(u, `/api/insights?month=2026-10&today=${today}`)).json;
  const before = await ins();
  const food = before.overspending.find((o) => o.category === '식비');
  assert.equal(food.level, 'exceeded');

  await patchCat(u, (await find(u, 'expense', '식비')).id, { active: false });
  const inactive = await ins();
  assert.deepEqual(inactive.overspending, before.overspending);
  assert.deepEqual(inactive.largeExpenses, before.largeExpenses);

  await patchCat(u, (await find(u, 'expense', '식비')).id, { name: '밥값' });
  await patchCat(u, (await find(u, 'expense', '쇼핑')).id, { name: '구매' });
  const renamed = await ins();
  const newFood = renamed.overspending.find((o) => o.category === '밥값');
  assert.deepEqual({ ...newFood, category: '식비' }, food);
  assert.ok(!renamed.overspending.some((o) => o.category === '식비'));
  assert.deepEqual(renamed.largeExpenses.map((x) => ({ ...x, category: undefined })), before.largeExpenses.map((x) => ({ ...x, category: undefined })));
  assert.equal(renamed.largeExpenses[0].category, '구매');
  // R3: 월세/넷플릭스 그룹은 메모 기준이라 그대로. 이름만 바꾼 문화/여가 반영
  await patchCat(u, (await find(u, 'expense', '문화/여가')).id, { name: '여가' });
  const r3 = (await ins()).recurring.find((x) => x.memo === '넷플릭스');
  assert.equal(r3.category, '여가');
  assert.equal(r3.occurrences, before.recurring.find((x) => x.memo === '넷플릭스').occurrences);
});

test('C-C22 동률 정렬: sortOrder 순, 새 카테고리는 기본 세트 뒤, 이름 변경해도 순서 유지', async () => {
  const u = await A();
  await addCat(u, 'expense', '가장앞글자');
  for (const category of ['가장앞글자', '기타', '교통', '식비']) await postTx(u, tx({ category, amount: 1000, memo: '', date: '2026-10-05' }));
  const order = async () => (await get(u, '/api/stats/categories?from=2026-10&to=2026-10')).json.items.map((i) => i.category);
  assert.deepEqual(await order(), ['식비', '교통', '기타', '가장앞글자']);
  assert.deepEqual((await get(u, '/api/stats/category-monthly?from=2026-10&to=2026-10')).json.series.map((s) => s.category), await order());
  assert.deepEqual((await get(u, '/api/summary?month=2026-10')).json.byCategory.map((s) => s.category), await order());
  // 식비를 '힣'으로 바꿔도 sortOrder 는 그대로(맨 앞)
  await patchCat(u, (await find(u, 'expense', '식비')).id, { name: '힣' });
  assert.deepEqual(await order(), ['힣', '교통', '기타', '가장앞글자']);
});

test('R4 동률 정렬은 사용자 sortOrder 를 쓴다 (같은 ratio)', async () => {
  const u = await A();
  const today = '2026-10-19';
  // 두 카테고리가 같은 ratio 로 exceeded: 지난 3달 20,000 / 이번 달 30,000
  for (const category of ['쇼핑', '교통']) {
    for (const date of ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']) {
      await postTx(u, tx({ category, memo: '', amount: date.startsWith('2026-10') ? 30000 : 20000, date }));
    }
  }
  const names = async () => (await get(u, `/api/insights?month=2026-10&today=${today}`)).json.overspending.map((o) => o.category);
  assert.deepEqual(await names(), ['교통', '쇼핑']);
  await app.db.query(`update categories set sort_order = 100 where user_id = $1 and name = '교통'`, [u.id]);
  assert.deepEqual(await names(), ['쇼핑', '교통']);
});

test('거래 POST: 수입/지출 유형별 활성 목록, 사용자가 만든 카테고리로 기록, 이름 변경 직후 옛 이름 거부', async () => {
  const u = await A();
  const created = (await addCat(u, 'income', '이자')).json;
  assert.equal((await postTx(u, tx({ type: 'income', category: '이자' }))).status, 201);
  assert.equal((await postTx(u, tx({ type: 'expense', category: '이자' }))).status, 400);
  assert.equal((await find(u, 'income', '이자')).usedCount, 1);
  await patchCat(u, created.id, { name: '배당' });
  assert.equal((await postTx(u, tx({ type: 'income', category: '이자' }))).status, 400);
  assert.equal((await postTx(u, tx({ type: 'income', category: '배당' }))).status, 201);
  assert.equal((await find(u, 'income', '배당')).usedCount, 2);
  // 이름은 정확히 일치해야 한다 (대소문자·공백 정규화 없음)
  await addCat(u, 'expense', 'Netflix');
  assert.equal((await postTx(u, tx({ category: 'netflix' }))).status, 400);
  assert.equal((await postTx(u, tx({ category: 'Netflix' }))).status, 201);
});

test('이름 변경과 거래 POST 가 동시에 와도 목록에 없는 옛 이름의 새 거래가 남지 않는다', async () => {
  const u = await A();
  const cafe = await find(u, 'expense', '카페/간식');
  const calls = [patchCat(u, cafe.id, { name: '커피' })];
  for (let i = 0; i < 6; i++) calls.push(postTx(u, tx({ memo: `m${i}` })));
  await Promise.all(calls);
  const { rows } = await app.db.query(`select category, count(*)::int n from transactions where user_id = $1 group by 1`, [u.id]);
  assert.ok(!rows.some((r) => r.category === '카페/간식'), JSON.stringify(rows));
});

test('가입은 사용자와 기본 카테고리를 함께 만든다 (이메일 중복이면 둘 다 없음)', async () => {
  await A();
  const dup = await app.request('POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  assert.equal(dup.status, 409);
  assert.equal((await app.db.query('select count(*)::int n from categories')).rows[0].n, 12);
  await B();
  assert.equal((await app.db.query('select count(*)::int n from categories')).rows[0].n, 24);
});

test('오류 응답 형식: { error: { code, message } } 이고 SQL/스택 없음', async () => {
  const u = await A();
  const rs = [
    await addCat(u, 'expense', '식비'),
    await addCat(u, 'expense', ''),
    await patchCat(u, 'x', { active: true }).then((r) => r),
    await patchCat(u, '00000000-0000-4000-8000-000000000000', { active: true }),
  ];
  for (const r of rs) {
    assert.ok(r.json.error.code && r.json.error.message);
    assert.ok(!/select|insert|update|stack|\bat \w/i.test(r.text), r.text);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
});
