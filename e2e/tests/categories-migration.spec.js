// docs/plan-categories.md Q-C1 / Q-C2: 마이그레이션 멱등성(C-C1~C-C3), 구버전 코드 호환(C-C4), 지연 생성(C-C5).
// 커밋 22bbc17(카테고리 기능 이전) 의 코드를 임시 디렉터리에 풀어(git archive, 저장소 상태 변경 없음) 구버전 서버로 쓴다.
// 로컬 PGlite 임시 디렉터리만 사용한다. 운영/Neon 에는 접속하지 않는다.
import { test, expect } from '@playwright/test';
import { newApi, json, get, signup } from '../helpers/api.js';
import { newAccount } from '../helpers/accounts.js';
import { startServer, migrate, tmpPgliteDir, removeDir, dbQuery, dbExec, checkoutCommit, removeCheckout } from '../helpers/server.js';

const OLD_COMMIT = '22bbc17';
const DEFAULT_EXPENSE = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'];
const DEFAULT_INCOME = ['급여', '용돈', '부수입', '기타'];

test.describe.configure({ mode: 'serial' });

test.describe('Q-C1/Q-C2 마이그레이션과 구버전 호환', () => {
  test.setTimeout(240_000);
  let oldDir; let dbDir;
  const users = []; // { email, password, api, id, name }
  let snapshot; // 적용 전 거래 요약
  const lazyUsers = [];

  const txSummary = () => dbQuery(dbDir, `select user_id, type, category, count(*)::int as n, sum(amount)::int as total from transactions group by 1,2,3 order by 1,2,3`);
  const txTotals = () => dbQuery(dbDir, 'select count(*)::int as n, coalesce(sum(amount),0)::int as total from transactions')[0];
  const catRows = (uid) => dbQuery(dbDir, `select type, name, active, sort_order from categories where user_id='${uid}' order by type desc, sort_order`);
  const cols = () => dbQuery(dbDir, `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='transactions' order by ordinal_position`);
  const cons = () => dbQuery(dbDir, `select conname, contype, pg_get_constraintdef(oid) as def from pg_constraint where conrelid='transactions'::regclass order by conname`);

  test.beforeAll(async () => {
    oldDir = checkoutCommit(OLD_COMMIT);
    dbDir = tmpPgliteDir();
  });
  test.afterAll(async () => {
    if (oldDir) removeCheckout(oldDir);
    if (dbDir) removeDir(dbDir);
  });

  test('Q-C1 픽스처: 구버전 스키마+구버전 서버로 사용자 3명, 기본 카테고리 전부 쓴 거래 생성', async () => {
    migrate(dbDir, {}, oldDir);
    expect(dbQuery(dbDir, `select to_regclass('public.categories') as t`)[0].t).toBeNull();
    const old = await startServer({ dir: dbDir, cwd: oldDir });
    try {
      for (const tag of ['mA', 'mB', 'mC']) {
        const acc = newAccount(tag);
        const api = await newApi({ baseURL: old.url });
        const r = await signup(api, acc);
        expect(r.status()).toBe(201);
        const user = (await r.json()).user;
        // 구버전의 GET /api/categories 는 {expense, income} 만
        const c = await (await get(api, '/api/categories')).json();
        expect(Object.keys(c).sort()).toEqual(['expense', 'income']);
        let n = 0;
        for (const cat of DEFAULT_EXPENSE) {
          n += 1;
          const rr = await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 1000 * n + (tag === 'mA' ? 7 : 0), category: cat, memo: `m${n}`, date: `2026-10-${String(n).padStart(2, '0')}` });
          expect(rr.status()).toBe(201);
        }
        for (const cat of DEFAULT_INCOME) {
          n += 1;
          const rr = await json(api, 'POST', '/api/transactions', { type: 'income', amount: 100000 * (n - 8), category: cat, memo: '', date: '2026-10-20' });
          expect(rr.status()).toBe(201);
        }
        users.push({ ...acc, id: user.id, tag });
      }
    } finally { await old.stop(); }
    // 방어 케이스: 구버전이 만들 수 없는 목록 밖 문자열이 직접 들어간 사용자 D (users 에 직접 INSERT)
    dbExec(dbDir, `
      insert into users (id, email, password_hash) values ('11111111-1111-4111-8111-111111111111', 'legacy-d@example.com', 'x');
      insert into transactions (user_id, type, amount, category, memo, date) values
        ('11111111-1111-4111-8111-111111111111', 'expense', 500, '경조사', '', '2026-10-01'),
        ('11111111-1111-4111-8111-111111111111', 'expense', 600, '${'가'.repeat(20)}', '', '2026-10-02'),
        ('11111111-1111-4111-8111-111111111111', 'income', 700, '식비', '', '2026-10-03'),
        ('11111111-1111-4111-8111-111111111111', 'expense', 800, '식비', '', '2026-10-04'),
        ('11111111-1111-4111-8111-111111111111', 'expense', 900, 'Pet', '', '2026-10-05'),
        ('11111111-1111-4111-8111-111111111111', 'expense', 950, 'pet', '', '2026-10-06');`);
    snapshot = { totals: txTotals(), by: txSummary(), cols: cols(), cons: cons() };
    expect(snapshot.totals.n).toBe(3 * 12 + 6);
  });

  test('C-C1/C-C2 새 마이그레이션 2회 연속 성공, categories 생성, transactions 구조·데이터 불변, 사용자당 정확히 12행', async () => {
    const out1 = migrate(dbDir);
    expect(out1).toContain('마이그레이션 완료 (driver=pglite');
    expect(out1).toMatch(/categories 생성 사용자=4/);
    const out2 = migrate(dbDir);
    expect(out2).toMatch(/categories 생성 사용자=0/);
    expect(dbQuery(dbDir, `select to_regclass('public.categories') is not null as ok`)[0].ok).toBe(true);
    // C-C1: transactions 컬럼·제약 변화 없음
    expect(cols()).toEqual(snapshot.cols);
    expect(cons()).toEqual(snapshot.cons);
    // C-C2: 거래 count/sum/카테고리별 건수 동일
    expect(txTotals()).toEqual(snapshot.totals);
    expect(txSummary()).toEqual(snapshot.by);
    for (const u of users) {
      const rows = catRows(u.id);
      expect(rows, u.tag).toHaveLength(12);
      expect(rows.filter((r) => r.type === 'expense').map((r) => r.name)).toEqual(DEFAULT_EXPENSE);
      expect(rows.filter((r) => r.type === 'income').map((r) => r.name)).toEqual(DEFAULT_INCOME);
      expect(rows.filter((r) => r.type === 'expense').map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(rows.filter((r) => r.type === 'income').map((r) => r.sort_order)).toEqual([0, 1, 2, 3]);
      expect(rows.every((r) => r.active === true)).toBe(true);
    }
    // 인덱스/제약 존재
    const idx = dbQuery(dbDir, `select indexname from pg_indexes where tablename='categories'`).map((r) => r.indexname);
    expect(idx).toContain('categories_user_type_sort_idx');
    const uq = dbQuery(dbDir, `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='categories'::regclass and contype='u'`);
    expect(uq.map((r) => r.def).join()).toContain('user_id, type, name_key');
  });

  test('C-C2(방어) 목록 밖 문자열은 비활성 행으로 노출(15자 초과·키 중복은 건너뜀), 거래는 그대로', async () => {
    const rows = catRows('11111111-1111-4111-8111-111111111111');
    const extra = rows.filter((r) => r.active === false);
    // 경조사(지출), 식비(수입; 수입 기본 세트에 없음), Pet(지출; 'pet' 은 키 중복이라 하나만)
    expect(extra.map((r) => `${r.type}:${r.name}`).sort()).toEqual(['expense:Pet', 'expense:경조사', 'income:식비'].sort().map((x) => x).sort());
    expect(rows.filter((r) => r.type === 'expense' && r.active)).toHaveLength(8);
    expect(rows.some((r) => r.name === '가'.repeat(20))).toBe(false);
    expect(rows).toHaveLength(12 + 3);
    expect(txTotals()).toEqual(snapshot.totals);
  });

  test('C-C3 이름 변경·사용 안 함 후 재마이그레이션: 되살아나지 않음, 12행 유지', async () => {
    const [A] = users;
    const srv = await startServer({ dir: dbDir });
    try {
      const api = await newApi({ baseURL: srv.url });
      expect((await json(api, 'POST', '/api/auth/login', { email: A.email, password: A.password })).status()).toBe(200);
      const b = await (await get(api, '/api/categories')).json();
      expect(b.items).toHaveLength(12);
      expect(b.expense).toEqual(DEFAULT_EXPENSE);
      expect(b.items.find((i) => i.name === '식비' && i.type === 'expense').usedCount).toBe(1);
      const food = b.items.find((i) => i.type === 'expense' && i.name === '식비');
      const bus = b.items.find((i) => i.type === 'expense' && i.name === '교통');
      expect((await json(api, 'PATCH', `/api/categories/${food.id}`, { name: '밥' })).status()).toBe(200);
      expect((await json(api, 'PATCH', `/api/categories/${bus.id}`, { active: false })).status()).toBe(200);
    } finally { await srv.stop(); }
    const out = migrate(dbDir);
    expect(out).toMatch(/categories 생성 사용자=0/);
    const rows = catRows(A.id);
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.name === '식비' && r.type === 'expense')).toHaveLength(0);
    expect(rows.find((r) => r.name === '밥')).toMatchObject({ active: true, sort_order: 0 });
    expect(rows.find((r) => r.name === '교통')).toMatchObject({ active: false, sort_order: 2 });
    // 거래는 새 이름으로
    const t = dbQuery(dbDir, `select count(*)::int as n from transactions where user_id='${A.id}' and category='식비' and type='expense'`)[0].n;
    expect(t).toBe(0);
    expect(dbQuery(dbDir, `select count(*)::int as n from transactions where user_id='${A.id}' and category='밥'`)[0].n).toBe(1);
    // 다른 사용자 불변
    expect(catRows(users[1].id).filter((r) => r.type === 'expense').map((r) => r.name)).toEqual(DEFAULT_EXPENSE);
  });

  test('C-C4 마이그레이션된 DB 로 구버전(22bbc17) 서버: 로그인·거래 CRUD·summary·stats·insights 정상', async () => {
    const [, B] = users;
    const old = await startServer({ dir: dbDir, cwd: oldDir });
    try {
      const api = await newApi({ baseURL: old.url });
      expect((await json(api, 'POST', '/api/auth/login', { email: B.email, password: B.password })).status()).toBe(200);
      expect((await get(api, '/api/auth/me')).status()).toBe(200);
      const created = await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 4321, category: '식비', memo: '구버전', date: '2026-10-21' });
      expect(created.status()).toBe(201);
      const tx = await created.json();
      const put = await json(api, 'PUT', `/api/transactions/${tx.id}`, { type: 'expense', amount: 4400, category: '교통', memo: '구버전', date: '2026-10-21' });
      expect(put.status()).toBe(200);
      const list = await (await get(api, '/api/transactions?month=2026-10')).json();
      expect(list.transactions.length).toBe(13);
      const sum = await (await get(api, '/api/summary?month=2026-10')).json();
      expect(sum.expenseTotal).toBeGreaterThan(0);
      for (const p of ['/api/stats/monthly?from=2026-05&to=2026-10', '/api/stats/categories?from=2026-10&to=2026-10&type=expense', '/api/stats/category-monthly?from=2026-05&to=2026-10&type=expense',
        '/api/insights?month=2026-10&today=2026-10-21', '/api/recommendations/quick?type=expense', '/api/recommendations/autocomplete?q=m&type=expense']) {
        expect((await get(api, p)).status(), p).toBe(200);
      }
      expect((await json(api, 'DELETE', `/api/transactions/${tx.id}`)).status()).toBe(204);
      // 신 코드에서 이름을 바꾼 사용자 A: 조회·집계는 정상, 새 이름 거래 수정(PUT)은 구버전 검증에 걸린다 (plan 14.3 주의: 알려진 롤백 한계)
      const [A] = users;
      const apiA = await newApi({ baseURL: old.url });
      expect((await json(apiA, 'POST', '/api/auth/login', { email: A.email, password: A.password })).status()).toBe(200);
      const listA = (await (await get(apiA, '/api/transactions?month=2026-10')).json()).transactions;
      const renamed = listA.find((t) => t.category === '밥');
      expect(renamed).toBeTruthy();
      expect((await get(apiA, '/api/summary?month=2026-10')).status()).toBe(200);
      const putA = await json(apiA, 'PUT', `/api/transactions/${renamed.id}`, { type: 'expense', amount: renamed.amount, category: '밥', memo: renamed.memo, date: renamed.date });
      expect(putA.status()).toBe(400); // 롤백 시 이름 변경 거래 수정 불가 (문서화된 한계)
      expect((await json(apiA, 'DELETE', `/api/transactions/${renamed.id}`)).status()).toBe(204); // 삭제는 가능
      // 구버전으로 신규 가입 (카테고리 행 없음 - 호환 기간 가입자)
      for (const tag of ['lz1', 'lz2']) {
        const acc = newAccount(tag);
        const a = await newApi({ baseURL: old.url });
        const r = await signup(a, acc);
        expect(r.status()).toBe(201);
        lazyUsers.push({ ...acc, id: (await r.json()).user.id });
      }
    } finally { await old.stop(); }
    for (const u of lazyUsers) expect(catRows(u.id)).toHaveLength(0);
  });

  test('C-C5 행이 없는 사용자: GET /api/categories 동시 5회 -> 모두 200, 정확히 12행', async () => {
    const [u1] = lazyUsers;
    const srv = await startServer({ dir: dbDir });
    try {
      const api = await newApi({ baseURL: srv.url });
      expect((await json(api, 'POST', '/api/auth/login', { email: u1.email, password: u1.password })).status()).toBe(200);
      const rs = await Promise.all([1, 2, 3, 4, 5].map(() => get(api, '/api/categories')));
      for (const r of rs) expect(r.status()).toBe(200);
      for (const r of rs) {
        const b = await r.json();
        expect(b.expense).toEqual(DEFAULT_EXPENSE);
        expect(b.income).toEqual(DEFAULT_INCOME);
        expect(b.items).toHaveLength(12);
      }
    } finally { await srv.stop(); }
    expect(catRows(u1.id)).toHaveLength(12);
  });

  test('C-C5 변형: 행이 없는 사용자가 거래 POST+조회 경로를 동시에 호출해도 12행으로 수렴, 500 없음', async () => {
    const [, u2] = lazyUsers;
    const srv = await startServer({ dir: dbDir });
    try {
      const api = await newApi({ baseURL: srv.url });
      expect((await json(api, 'POST', '/api/auth/login', { email: u2.email, password: u2.password })).status()).toBe(200);
      const calls = [
        json(api, 'POST', '/api/transactions', { type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-10-02' }),
        json(api, 'POST', '/api/transactions', { type: 'income', amount: 1000, category: '급여', memo: '', date: '2026-10-02' }),
        get(api, '/api/summary?month=2026-10'),
        get(api, '/api/stats/categories?from=2026-10&to=2026-10&type=expense'),
        get(api, '/api/insights?month=2026-10&today=2026-10-21'),
        get(api, '/api/recommendations/quick?type=expense'),
        get(api, '/api/categories'),
        get(api, '/api/categories'),
      ];
      const rs = await Promise.all(calls);
      expect(rs.map((r) => r.status())).toEqual([201, 201, 200, 200, 200, 200, 200, 200]);
    } finally { await srv.stop(); }
    expect(catRows(u2.id)).toHaveLength(12);
    // 배포 직후 재마이그레이션은 이미 행이 있는 사용자를 건드리지 않는다
    expect(migrate(dbDir)).toMatch(/categories 생성 사용자=0/);
    expect(catRows(u2.id)).toHaveLength(12);
  });

  test('C-C5 마이그레이션 재실행이 지연 생성 대상(행 없는 사용자)을 보강한다', async () => {
    dbExec(dbDir, `insert into users (id, email, password_hash) values ('22222222-2222-4222-8222-222222222222', 'legacy-e@example.com', 'x')`);
    expect(migrate(dbDir)).toMatch(/categories 생성 사용자=1/);
    expect(catRows('22222222-2222-4222-8222-222222222222')).toHaveLength(12);
  });
});
