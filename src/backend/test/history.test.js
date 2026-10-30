// GET /api/category-history 통합 테스트 - PGlite 메모리 DB + 실제 HTTP 서버
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, cookieFrom, GOOD_PASSWORD } from './helpers.js';

let app;
before(async () => {
  app = await startApp({}, { now: () => new Date('2026-10-18T16:00:00Z') });
});
after(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.db.exec('delete from transactions; delete from auth_attempts; delete from sessions; delete from users;');
});

async function newUser(email) {
  const r = await app.request('POST', '/api/auth/signup', { body: { email, password: GOOD_PASSWORD, name: '테스터' } });
  assert.equal(r.status, 201);
  return { cookie: cookieFrom(r), id: r.json.user.id };
}
const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'];
const get = (u, path) => app.request('GET', path, { cookie: u.cookie });
const q = (o) => '/api/category-history?' + new URLSearchParams(o).toString();
const hist = (u, o = {}) => get(u, q({ type: 'expense', category: '식비', ...o }));

// rows: [date, amount, createdAt(마이크로초 문자열), type, category, memo]
async function insert(u, rows) {
  for (const [date, amount, createdAt, type = 'expense', category = '식비', memo = ''] of rows) {
    await app.db.query(
      'insert into transactions (user_id, type, amount, category, memo, date, created_at) values ($1,$2,$3,$4,$5,$6::date,$7::timestamptz)',
      [u.id, type, amount, category, memo, date, createdAt],
    );
  }
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// 계획서 5.1 정렬 표를 JS 로 직접 구현한 기준 순서. 마이크로초 비교를 위해 DB 원값(text)을 쓴다.
async function expected(u, sort, category = '식비', type = 'expense') {
  const { rows } = await app.db.query(
    `select id, amount, date::text d, to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') c
       from transactions where user_id=$1 and type=$2 and category=$3`,
    [u.id, type, category],
  );
  const desc = (a, b) => cmp(b.d, a.d) || cmp(b.c, a.c) || cmp(b.id, a.id);
  const by = {
    date_desc: desc,
    date_asc: (a, b) => desc(b, a),
    amount_desc: (a, b) => b.amount - a.amount || desc(a, b),
    amount_asc: (a, b) => a.amount - b.amount || desc(a, b),
  }[sort];
  return rows.sort(by).map((r) => r.id);
}
async function allPages(u, sort, limit, extra = {}) {
  const ids = [];
  const pages = [];
  let cursor;
  do {
    const r = await hist(u, { sort, limit, ...(cursor ? { cursor } : {}), ...extra });
    assert.equal(r.status, 200, r.text);
    pages.push(r.json.transactions.length);
    ids.push(...r.json.transactions.map((t) => t.id));
    cursor = r.json.nextCursor;
  } while (cursor);
  return { ids, pages };
}

// 같은 금액·같은 날·같은 밀리초(마이크로초만 다름)가 섞인 n건
function tricky(n = 75) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 5)).padStart(2, '0');
    const amount = [1000, 2000, 1000, 3000, 2000][i % 5];
    const micro = String(100000 + (i % 7) * 11).padStart(6, '0'); // 같은 밀리초 100, 마이크로초만 다름
    rows.push([`2026-0${1 + (i % 3)}-${day}`, amount, `2026-05-01T00:00:00.${micro}Z`]);
  }
  return rows;
}

test('C-H1 기본: sort 생략은 date_desc, 요약이 직접 계산한 값과 같다, count == usedCount', async () => {
  const u = await newUser('a@example.com');
  await insert(u, [
    ['2026-10-28', 12000, '2026-10-28T03:12:45.123456Z', 'expense', '식비', '점심'],
    ['2026-10-28', 5000, '2026-10-28T05:00:00.000001Z'],
    ['2026-09-03', 7000, '2026-09-03T00:00:00Z'],
    ['2026-03-02', 1000, '2026-03-02T00:00:00Z'],
    ['2026-12-25', 3000, '2026-09-04T00:00:00Z'], // 미래 날짜도 포함
    ['2026-10-28', 99999, '2026-10-28T00:00:00Z', 'expense', '교통'],
  ]);
  const r = await hist(u);
  assert.equal(r.status, 200);
  assert.equal(r.json.sort, 'date_desc');
  assert.equal(r.json.total, 28000);
  assert.equal(r.json.count, 5);
  assert.equal(r.json.firstDate, '2026-03-02');
  assert.equal(r.json.lastDate, '2026-12-25');
  assert.deepEqual(r.json.months, [
    { month: '2026-12', total: 3000, count: 1 },
    { month: '2026-10', total: 17000, count: 2 },
    { month: '2026-09', total: 7000, count: 1 },
    { month: '2026-03', total: 1000, count: 1 },
  ]);
  assert.deepEqual(r.json.transactions.map((t) => t.date), ['2026-12-25', '2026-10-28', '2026-10-28', '2026-09-03', '2026-03-02']);
  assert.equal(r.json.transactions[1].amount, 5000); // 같은 날은 created_at 내림차순
  assert.equal(r.json.transactions[2].memo, '점심');
  assert.equal(r.json.transactions[2].createdAt, '2026-10-28T03:12:45.123Z');
  assert.equal(r.json.nextCursor, null);
  const cat = (await get(u, '/api/categories')).json.items.find((i) => i.type === 'expense' && i.name === '식비');
  assert.equal(cat.usedCount, r.json.count);
});

test('C-H6 정렬 4종 순서가 정렬 표와 같고 date_asc 는 date_desc 의 역순', async () => {
  const u = await newUser('a@example.com');
  await insert(u, tricky(60));
  const got = {};
  for (const sort of SORTS) {
    const r = await hist(u, { sort, limit: 100 });
    assert.equal(r.json.sort, sort);
    got[sort] = r.json.transactions.map((t) => t.id);
    assert.deepEqual(got[sort], await expected(u, sort), sort);
  }
  assert.deepEqual([...got.date_asc].reverse(), got.date_desc);
});

test('C-H7 동점: 같은 금액은 두 금액순 모두 최신 먼저, 반복 요청도 같은 순서', async () => {
  const u = await newUser('a@example.com');
  await insert(u, [
    ['2026-01-01', 4500, '2026-01-01T00:00:00.000001Z'],
    ['2026-03-01', 4500, '2026-03-01T00:00:00.000001Z'],
    ['2026-03-01', 4500, '2026-03-01T00:00:00.000002Z'],
    ['2026-02-01', 9000, '2026-02-01T00:00:00Z'],
    ['2026-02-01', 100, '2026-02-01T00:00:00Z'],
  ]);
  for (const sort of ['amount_desc', 'amount_asc']) {
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await hist(u, { sort }));
    const ids = rs.map((r) => r.json.transactions.map((t) => t.id).join());
    assert.equal(new Set(ids).size, 1);
    const same = rs[0].json.transactions.filter((t) => t.amount === 4500);
    assert.deepEqual(same.map((t) => t.date), ['2026-03-01', '2026-03-01', '2026-01-01']);
    assert.ok(same[0].createdAt >= same[1].createdAt);
  }
  assert.deepEqual((await hist(u, { sort: 'amount_desc' })).json.transactions.map((t) => t.amount), [9000, 4500, 4500, 4500, 100]);
  assert.deepEqual((await hist(u, { sort: 'amount_asc' })).json.transactions.map((t) => t.amount), [100, 4500, 4500, 4500, 9000]);
});

test('C-H8 쪽 나눔: 정렬 4종 x 75건 30/30/15, 겹침·빠짐 없음', async () => {
  const u = await newUser('a@example.com');
  await insert(u, tricky(75));
  for (const sort of SORTS) {
    const { ids, pages } = await allPages(u, sort, 30);
    assert.deepEqual(pages, [30, 30, 15], sort);
    assert.equal(new Set(ids).size, 75);
    assert.deepEqual(ids, await expected(u, sort), sort);
  }
});

test('C-H8 쪽 크기 1·2·3·7 의 모든 경계에서 겹침·빠짐 없음 (date·amount·created_at 이 모두 같은 행 포함)', async () => {
  const u = await newUser('a@example.com');
  const rows = tricky(40);
  for (let i = 0; i < 8; i++) rows.push(['2026-02-02', 2000, '2026-05-01T00:00:00.100000Z']); // id 로만 구분
  await insert(u, rows);
  for (const sort of SORTS) {
    for (const limit of [1, 2, 3, 7]) {
      const { ids } = await allPages(u, sort, limit);
      assert.deepEqual(ids, await expected(u, sort), `${sort} limit=${limit}`);
    }
  }
});

test('C-H8 쪽 사이에 거래를 추가·삭제해도 이미 받은 행이 다시 나오지 않는다', async () => {
  const u = await newUser('a@example.com');
  for (const sort of SORTS) {
    await app.db.exec('delete from transactions');
    await insert(u, tricky(20));
    const first = await hist(u, { sort, limit: 5 });
    const seen = first.json.transactions.map((t) => t.id);
    await insert(u, [['2026-03-30', 2000, '2026-06-01T00:00:00Z']]);
    await app.db.query('delete from transactions where id = $1', [seen[0]]);
    const second = await hist(u, { sort, limit: 100, cursor: first.json.nextCursor });
    assert.equal(second.status, 200);
    for (const t of second.json.transactions) assert.ok(!seen.includes(t.id), sort);
  }
});

test('C-H9 정렬이 다른 커서는 400 fields.cursor, 같은 정렬이면 200, 요약은 정렬과 무관', async () => {
  const u = await newUser('a@example.com');
  await insert(u, tricky(20));
  const first = await hist(u, { limit: 5 }); // sort 생략 = date_desc
  assert.ok(first.json.nextCursor);
  for (const sort of ['date_asc', 'amount_desc', 'amount_asc']) {
    const r = await hist(u, { sort, cursor: first.json.nextCursor });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.match(r.json.error.fields.cursor, /정렬이 바뀌어/);
  }
  assert.equal((await hist(u, { sort: 'date_desc', cursor: first.json.nextCursor })).status, 200);
  assert.equal((await hist(u, { cursor: first.json.nextCursor })).status, 200);
  const amountCursor = (await hist(u, { sort: 'amount_asc', limit: 5 })).json.nextCursor;
  assert.equal((await hist(u, { cursor: amountCursor })).status, 400); // sort 생략 = date_desc
  const sums = [];
  for (const sort of SORTS) {
    const { total, count, firstDate, lastDate, months } = (await hist(u, { sort, limit: 3 })).json;
    sums.push(JSON.stringify({ total, count, firstDate, lastDate, months }));
  }
  assert.equal(new Set(sums).size, 1);
});

test('C-H2 격리: 다른 사용자의 같은 이름 카테고리와 같은 이름의 다른 type 이 섞이지 않는다', async () => {
  const a = await newUser('a@example.com');
  const b = await newUser('b@example.com');
  await insert(a, [['2026-01-01', 1000, '2026-01-01T00:00:00Z'], ['2026-01-02', 5000, '2026-01-02T00:00:00Z', 'income', '기타']]);
  await insert(b, [['2026-01-03', 7777, '2026-01-03T00:00:00Z'], ['2026-01-04', 3333, '2026-01-04T00:00:00Z', 'expense', '기타']]);
  const ra = await hist(a);
  assert.deepEqual(ra.json.transactions.map((t) => t.amount), [1000]);
  assert.equal(ra.json.total, 1000);
  assert.deepEqual((await hist(b)).json.transactions.map((t) => t.amount), [7777]);
  const inc = await hist(a, { type: 'income', category: '기타' });
  assert.deepEqual(inc.json.transactions.map((t) => t.amount), [5000]);
  assert.equal((await hist(a, { type: 'expense', category: '기타' })).json.count, 0);
  // B 의 커서를 A 가 써도 A 의 데이터만 위치 조건으로 쓰인다
  await insert(b, [['2026-02-01', 1, '2026-02-01T00:00:00Z'], ['2026-02-02', 1, '2026-02-02T00:00:00Z']]);
  const cur = (await hist(b, { limit: 1 })).json.nextCursor;
  const viaA = await hist(a, { cursor: cur });
  assert.equal(viaA.status, 200);
  assert.ok(viaA.json.transactions.every((t) => t.amount === 1000));
});

test('C-H3 사용 안 함·목록 밖 이름은 200, 없는 이름은 빈 결과, categories 행이 생기지 않는다', async () => {
  const u = await newUser('a@example.com');
  await insert(u, [['2026-01-01', 1000, '2026-01-01T00:00:00Z', 'expense', '옛카테고리']]);
  const cat = (await get(u, '/api/categories')).json.items.find((i) => i.name === '쇼핑');
  const patched = await app.request('PATCH', `/api/categories/${cat.id}`, { body: { active: false }, cookie: u.cookie });
  assert.equal(patched.status, 200);
  await insert(u, [['2026-01-02', 2000, '2026-01-02T00:00:00Z', 'expense', '쇼핑']]);
  assert.equal((await hist(u, { category: '옛카테고리' })).json.count, 1);
  assert.equal((await hist(u, { category: '쇼핑' })).json.total, 2000);
  const empty = await hist(u, { category: '없는이름', sort: 'amount_asc' });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, {
    type: 'expense', category: '없는이름', sort: 'amount_asc', total: 0, count: 0,
    firstDate: null, lastDate: null, months: [], transactions: [], nextCursor: null,
  });
  await app.db.query('delete from categories where user_id = $1', [u.id]);
  assert.equal((await hist(u, { category: '식비' })).status, 200);
  assert.equal((await app.db.query('select count(*)::int n from categories where user_id = $1', [u.id])).rows[0].n, 0);
});

test('C-H4 잘못된 파라미터는 400 과 해당 fields', async () => {
  const u = await newUser('a@example.com');
  const bad = async (qs, field) => {
    const r = await get(u, '/api/category-history?' + qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
    assert.ok(field in r.json.error.fields, `${qs} -> ${JSON.stringify(r.json.error.fields)}`);
  };
  const ok = 'type=expense&category=%EC%8B%9D%EB%B9%84';
  await bad('category=%EC%8B%9D%EB%B9%84', 'type');
  await bad('type=bad&category=x', 'type');
  await bad('type=expense', 'category');
  await bad('type=expense&category=', 'category');
  await bad('type=expense&category=' + 'a'.repeat(51), 'category');
  await bad('type=expense&category=a%00b', 'category');
  await bad('type=expense&category=a%0Ab', 'category');
  await bad(`${ok}&sort=`, 'sort');
  await bad(`${ok}&sort=price`, 'sort');
  await bad(`${ok}&sort=DATE_DESC`, 'sort');
  for (const l of ['0', '101', '1.5', 'abc', '', '-1', '1e1', '+5']) await bad(`${ok}&limit=${l}`, 'limit');
  await bad(`${ok}&cursor=`, 'cursor');
  await bad(`${ok}&cursor=!!!`, 'cursor');
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const good = { s: 'date_desc', d: '2026-01-01', c: '2026-01-01T00:00:00.000001Z', i: '11111111-1111-1111-1111-111111111111' };
  await bad(`${ok}&cursor=${enc({ ...good, s: 'zzz' })}`, 'cursor');
  await bad(`${ok}&cursor=${enc({ ...good, d: '2026-02-30' })}`, 'cursor');
  await bad(`${ok}&cursor=${enc({ ...good, c: '2026-01-01' })}`, 'cursor');
  await bad(`${ok}&cursor=${enc({ ...good, i: 'nope' })}`, 'cursor');
  await bad(`${ok}&cursor=${enc({ s: 'date_desc' })}`, 'cursor');
  await bad(`${ok}&cursor=${enc([1])}`, 'cursor');
  for (const c of ['2026-13-01T00:00:00.000000Z', '2026-01-45T00:00:00.000000Z', '2026-01-01T24:00:00.000000Z',
    '2026-01-01T00:60:00.000000Z', '2026-01-01T00:00:60.000000Z', '2026-02-30T00:00:00.000000Z', '2026-13-45T99:99:99.000000Z']) {
    await bad(`${ok}&cursor=${enc({ ...good, c })}`, 'cursor');
  }
  await bad(`${ok}&cursor=${enc({ ...good, d: '2026-13-45' })}`, 'cursor');
  const am = { ...good, s: 'amount_desc' };
  await bad(`${ok}&sort=amount_desc&cursor=${enc(am)}`, 'cursor'); // a 없음
  await bad(`${ok}&sort=amount_desc&cursor=${enc({ ...am, a: 1.5 })}`, 'cursor');
  await bad(`${ok}&sort=amount_desc&cursor=${enc({ ...am, a: 100000001 })}`, 'cursor');
  assert.equal((await get(u, `/api/category-history?${ok}&limit=100&foo=1`)).status, 200);
  assert.equal((await get(u, `/api/category-history?${ok}&cursor=${enc(good)}`)).status, 200);
  assert.equal((await get(u, `/api/category-history?${ok}&cursor=${enc({ ...good, c: '2026-12-31T23:59:59.999999Z' })}`)).status, 200);
  assert.equal((await get(u, `/api/category-history?${ok}&sort=amount_asc&cursor=${enc({ ...am, s: 'amount_asc', a: 5 })}`)).status, 200);
});

test('C-H4 401 세션 없음, 405 Allow: GET, 공통 헤더', async () => {
  const u = await newUser('a@example.com');
  const noAuth = await app.request('GET', q({ type: 'expense', category: '식비' }));
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error.code, 'UNAUTHENTICATED');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await app.request(m, '/api/category-history', { cookie: u.cookie, body: {} });
    assert.equal(r.status, 405, m);
    assert.equal(r.headers.allow, 'GET');
  }
  const ok = await hist(u);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.match(ok.headers['content-type'], /application\/json/);
});

test('커서의 created_at 은 마이크로초 그대로 담긴다(밀리초 ISO 아님)', async () => {
  const u = await newUser('a@example.com');
  await insert(u, [['2026-01-01', 1000, '2026-01-01T00:00:00.123456Z'], ['2026-01-01', 1000, '2026-01-01T00:00:00.123457Z']]);
  const r = await hist(u, { limit: 1 });
  const c = JSON.parse(Buffer.from(r.json.nextCursor, 'base64url').toString());
  assert.equal(c.c, '2026-01-01T00:00:00.123457Z');
  assert.deepEqual(Object.keys(c).sort(), ['c', 'd', 'i', 's']);
  const next = await hist(u, { limit: 1, cursor: r.json.nextCursor });
  assert.equal(next.json.transactions.length, 1);
  assert.equal(next.json.nextCursor, null);
});

test('C-H5 성능: 5,000건(한 카테고리 1,000건) 정렬 4종 x 첫/마지막 쪽 300ms 이하', async (t) => {
  const u = await newUser('a@example.com');
  await app.db.query(
    `insert into transactions (user_id, type, amount, category, memo, date, created_at)
     select $1, 'expense', (1 + (g % 40)) * 500, case when g % 5 = 0 then '식비' else '교통' end, '',
            date '2025-01-01' + (g % 700), timestamptz '2026-01-01' + (g * interval '1 second') + ((g % 3) * interval '1 microsecond')
       from generate_series(1, 5000) g`,
    [u.id],
  );
  const timings = {};
  for (const sort of SORTS) {
    let cursor;
    let n = 0;
    const slow = { first: 0, last: 0 };
    for (;;) {
      const t0 = performance.now();
      const r = await hist(u, { sort, ...(cursor ? { cursor } : {}) });
      const ms = performance.now() - t0;
      assert.equal(r.status, 200);
      n += r.json.transactions.length;
      if (!cursor) slow.first = ms;
      cursor = r.json.nextCursor;
      if (!cursor) {
        slow.last = ms;
        break;
      }
    }
    assert.equal(n, 1000);
    timings[sort] = { first: Math.round(slow.first), last: Math.round(slow.last) };
    assert.ok(slow.first <= 300 && slow.last <= 300, `${sort} ${JSON.stringify(slow)}`);
  }
  t.diagnostic(`성능(ms): ${JSON.stringify(timings)}`);
  console.log('[perf] category-history ms', JSON.stringify(timings));
});
