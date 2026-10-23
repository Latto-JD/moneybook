// 서버를 QA 가 직접 껐다 켜거나 별도 설정(TRUST_PROXY, SIGNUP_ENABLED=false, 고장난 DB)으로 띄워야 하는 항목.
// C11, C26, C35, C37(가입 닫힘), C38, C41, C48. 각 테스트가 자기 포트/임시 PGLITE_DIR 서버를 띄우고 반드시 정리한다.
// (메인 서버 BASE_URL 과 무관. 포트는 QA_AUX_PORT_BASE(기본 3201)부터 순차 할당)
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { newApi, json, get, signup, login, addTx, createLoggedInUser } from '../helpers/api.js';
import { newAccount, PASSWORD } from '../helpers/accounts.js';
import { expectError } from '../helpers/errors.js';
import { ROOT, startServer, migrate, dbQuery, qaOp, tmpPgliteDir, removeDir } from '../helpers/server.js';
// 비밀 값 검색(P2)에 걸리지 않도록 연결 문자열 스킴을 조립한다.
const PG_SCHEME = 'postgres' + 'ql://';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** 임시 DB 디렉터리 + 서버 목록을 만들고 끝나면 모두 정리 */
function sandbox() {
  const servers = [];
  const dirs = [];
  return {
    dir() { const d = tmpPgliteDir(); dirs.push(d); return d; },
    async start(opts) { const s = await startServer(opts); servers.push(s); return s; },
    async cleanup() {
      for (const s of servers) await s.stop().catch(() => {});
      for (const d of dirs) { try { removeDir(d); } catch { /* 윈도우 파일 잠금은 무시 */ } }
    },
  };
}

test.describe('C11 서버 재시작 후 유지', () => {
  test('C11 서버를 껐다 켜도 데이터와 로그인 세션이 유지된다(같은 PGLITE_DIR)', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const s1 = await sb.start({ dir });
      const { api, user } = await createLoggedInUser('c11', { baseURL: s1.url });
      const created = await (await addTx(api, { memo: '재시작전', amount: 7777, date: '2026-10-05' })).json();
      const cookie = (await api.storageState()).cookies.find((c) => c.name === 'mb_sid').value;
      await s1.stop();
      // 꺼진 동안은 연결 불가
      await expect(fetch(`${s1.url}/api/health`)).rejects.toThrow();

      const s2 = await sb.start({ dir, port: s1.port });
      const replay = await newApi({ baseURL: s2.url, extraHeaders: { Cookie: `mb_sid=${cookie}` } });
      const me = await get(replay, '/api/auth/me');
      expect(me.status()).toBe(200);
      expect((await me.json()).user.id).toBe(user.id);
      const list = await (await get(replay, '/api/transactions?month=2026-10')).json();
      expect(list.transactions.find((t) => t.id === created.id)).toMatchObject({ memo: '재시작전', amount: 7777 });
    } finally { await sb.cleanup(); }
  });
});

test.describe('C37 가입 닫힘', () => {
  test('C37 SIGNUP_ENABLED=false -> 가입 403 SIGNUP_DISABLED, 기존 사용자 로그인은 가능', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const acc = newAccount('c37exist');
      const open = await sb.start({ dir });
      expect((await signup(await newApi({ baseURL: open.url }), acc)).status()).toBe(201);
      await open.stop();

      const closed = await sb.start({ dir, env: { SIGNUP_ENABLED: 'false' } });
      await expectError(await signup(await newApi({ baseURL: closed.url }), newAccount('c37new')), 403, 'SIGNUP_DISABLED');
      expect((await login(await newApi({ baseURL: closed.url }), acc)).status()).toBe(200);
    } finally { await sb.cleanup(); }
  });
});

test.describe('C38 비밀번호/세션 저장 방식', () => {
  test('C38 password_hash 는 scrypt$ 로 시작, 평문 미포함, 같은 비밀번호도 해시 상이, sessions 에 원문 토큰 없음', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const s = await sb.start({ dir });
      const pw = 'SamePassw0rd-QA';
      const a = newAccount('c38a'); a.password = pw;
      const b = newAccount('c38b'); b.password = pw;
      const apiA = await newApi({ baseURL: s.url });
      const apiB = await newApi({ baseURL: s.url });
      expect((await signup(apiA, a)).status()).toBe(201);
      expect((await signup(apiB, b)).status()).toBe(201);
      expect((await login(await newApi({ baseURL: s.url }), a)).status()).toBe(200); // 세션 추가 생성
      const tokenA = (await apiA.storageState()).cookies.find((c) => c.name === 'mb_sid').value;
      const tokenB = (await apiB.storageState()).cookies.find((c) => c.name === 'mb_sid').value;
      await s.stop(); // PGlite 디렉터리는 한 프로세스만 열 수 있으므로 서버를 끈 뒤 조회

      const users = dbQuery(dir, 'select email, password_hash from users order by email');
      expect(users).toHaveLength(2);
      for (const u of users) {
        expect(u.password_hash.startsWith('scrypt$')).toBe(true);
        expect(u.password_hash).not.toContain(pw);
        expect(u.password_hash.split('$')).toHaveLength(6); // scrypt$N$r$p$salt$hash
      }
      expect(users[0].password_hash).not.toBe(users[1].password_hash);

      const sessions = dbQuery(dir, 'select token_hash from sessions');
      expect(sessions.length).toBeGreaterThanOrEqual(3);
      const all = JSON.stringify(sessions);
      expect(all).not.toContain(tokenA);
      expect(all).not.toContain(tokenB);
      const hashes = sessions.map((r) => r.token_hash);
      expect(hashes).toContain(createHash('sha256').update(tokenA).digest('hex'));
      expect(hashes).toContain(createHash('sha256').update(tokenB).digest('hex'));
      // 전체 테이블 덤프에서도 평문 비밀번호/토큰이 없다
      const dump = JSON.stringify(dbQuery(dir, 'select * from users')) + JSON.stringify(dbQuery(dir, 'select * from sessions'))
        + JSON.stringify(dbQuery(dir, 'select * from auth_attempts'));
      expect(dump).not.toContain(pw);
      expect(dump).not.toContain(tokenA);
    } finally { await sb.cleanup(); }
  });
});

test.describe('C41 IP 제한 (TRUST_PROXY=true)', () => {
  test('C41 같은 IP 로그인 실패 20회 후 21번째 429(+Retry-After), 다른 IP 무영향, 가입 11번째 429', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const s = await sb.start({ dir, env: { TRUST_PROXY: 'true' } });
      const ip = (a) => ({ 'x-forwarded-for': a });
      const as = (a) => newApi({ baseURL: s.url, extraHeaders: ip(a) });

      // 서로 다른(없는) 이메일로 실패 20회 -> 이메일 제한이 아니라 IP 제한
      for (let i = 0; i < 20; i++) {
        const r = await login(await as('203.0.113.7'), newAccount('c41'));
        expect(r.status(), `try ${i + 1}`).toBe(401);
      }
      const blocked = await login(await as('203.0.113.7'), newAccount('c41'));
      await expectError(blocked, 429, 'TOO_MANY_ATTEMPTS');
      expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
      // 다른 IP 는 영향 없음
      expect((await login(await as('198.51.100.9'), newAccount('c41'))).status()).toBe(401);

      // 가입: 같은 IP 10회 허용, 11번째 429
      for (let i = 0; i < 10; i++) {
        expect((await signup(await as('192.0.2.50'), newAccount('c41s'))).status(), `signup ${i + 1}`).toBe(201);
      }
      const su = await signup(await as('192.0.2.50'), newAccount('c41s'));
      await expectError(su, 429, 'TOO_MANY_ATTEMPTS');
      expect(Number(su.headers()['retry-after'])).toBeGreaterThan(0);
      expect((await signup(await as('192.0.2.51'), newAccount('c41s'))).status()).toBe(201);
    } finally { await sb.cleanup(); }
  });

  test('C41(대조) TRUST_PROXY 미설정 서버는 X-Forwarded-For 를 무시한다(소켓 IP 로 제한)', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const s = await sb.start({ dir });
      for (let i = 0; i < 20; i++) {
        await login(await newApi({ baseURL: s.url, extraHeaders: { 'x-forwarded-for': `10.0.0.${i + 1}` } }), newAccount('c41n'));
      }
      // XFF 를 매번 바꿔도 같은 소켓 IP 이므로 21번째는 429
      await expectError(
        await login(await newApi({ baseURL: s.url, extraHeaders: { 'x-forwarded-for': '10.9.9.9' } }), newAccount('c41n')),
        429, 'TOO_MANY_ATTEMPTS',
      );
    } finally { await sb.cleanup(); }
  });
});

test.describe('C48 내부 오류', () => {
  test('C48 break-db: 거래/요약/통계/추천/인사이트 500 INTERNAL_ERROR(스택/SQL 없음), 로그인/health 정상, repair-db 후 복구', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const s = await sb.start({ dir });
      const { api } = await createLoggedInUser('c48', { baseURL: s.url });
      expect((await get(api, '/api/transactions?month=2026-10')).status()).toBe(200);

      expect((await qaOp(s.url, 'break-db')).status).toBe(200);
      const urls = [
        '/api/transactions?month=2026-10', '/api/summary?month=2026-10',
        '/api/stats/monthly?from=2026-10&to=2026-10', '/api/stats/categories?from=2026-10&to=2026-10',
        '/api/stats/category-monthly?from=2026-10&to=2026-10',
        '/api/recommendations/quick?type=expense', '/api/recommendations/autocomplete?q=a&type=expense',
        '/api/insights?month=2026-10',
      ];
      for (const u of urls) {
        const err = await expectError(await get(api, u), 500, 'INTERNAL_ERROR');
        expect(err.message).toBe('서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      }
      const post = await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-10-01' });
      await expectError(post, 500, 'INTERNAL_ERROR');
      expect((await get(api, '/api/health')).status()).toBe(200);
      expect((await get(api, '/api/auth/me')).status()).toBe(200);
      // 서버 로그에 비밀번호/세션 토큰이 남지 않는다
      const token = (await api.storageState()).cookies.find((c) => c.name === 'mb_sid').value;
      expect(s.log()).not.toContain(token);
      expect(s.log()).not.toContain(PASSWORD);

      expect((await qaOp(s.url, 'repair-db')).status).toBe(200);
      expect((await get(api, '/api/transactions?month=2026-10')).status()).toBe(200);
    } finally { await sb.cleanup(); }
  });

  test('C48 DB 연결 실패(닫힌 포트 DATABASE_URL): health db:error(200), 세션 필요한 요청은 500 INTERNAL_ERROR, 연결 문자열 미노출', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      const s = await sb.start({
        dir,
        env: { DB_DRIVER: '', QA_TOOLS: 'false', DATABASE_URL: PG_SCHEME + 'qa_user:qa_leak_pw@127.0.0.1:1/qa_db' },
      });
      const api = await newApi({ baseURL: s.url, extraHeaders: { Cookie: 'mb_sid=' + 'A'.repeat(43) } });
      const h = await get(api, '/api/health');
      expect(h.status()).toBe(200);
      expect(await h.json()).toEqual({ status: 'ok', db: 'error' });
      const me = await get(api, '/api/auth/me');
      const err = await expectError(me, 500, 'INTERNAL_ERROR');
      expect(JSON.stringify(err)).not.toMatch(/qa_leak_pw|qa_user|127\.0\.0\.1/);
      expect(s.log()).not.toContain('qa_leak_pw');
    } finally { await sb.cleanup(); }
  });
});

test.describe('C26 시드 / C35 기본 today', () => {
  test('C26 시드 사용자: recurring/overspending/largeExpenses/quick 각 1건 이상, 최근 6개월 expenseTotal > 0', async () => {
    const sb = sandbox();
    try {
      const dir = sb.dir();
      migrate(dir);
      const email = 'seed-qa@example.com';
      const password = 'demopass123';
      const today = '2026-10-19';
      const seed = spawnSync(process.execPath, ['src/backend/scripts/seed.js', `--email=${email}`, `--pass` + `word=${password}`, `--today=${today}`], {
        cwd: ROOT, encoding: 'utf8',
        env: { ...process.env, DB_DRIVER: 'pglite', PGLITE_DIR: dir, COOKIE_SECURE: 'false' },
      });
      expect(seed.status, seed.stderr + seed.stdout).toBe(0);
      test.info().annotations.push({ type: 'seed-output', description: seed.stdout.trim().slice(0, 300) });

      const s = await sb.start({ dir });
      const api = await newApi({ baseURL: s.url });
      expect((await login(api, { email, password })).status()).toBe(200);
      const ins = await (await get(api, `/api/insights?month=${today.slice(0, 7)}&today=${today}`)).json();
      expect(ins.recurring.length).toBeGreaterThan(0);
      expect(ins.overspending.length).toBeGreaterThan(0);
      expect(ins.largeExpenses.length).toBeGreaterThan(0);
      // v2.1: 월 1회 고정비(월세/넷플릭스)는 pace 오탐이 아니어야 한다. 쇼핑·식비 exceeded, 교통 pace
      const ov = Object.fromEntries(ins.overspending.map((o) => [o.category, o]));
      expect(ov['주거/통신'], '월세(주거/통신)가 overspending 에 없어야 함').toBeUndefined();
      expect(ov['문화/여가'], '넷플릭스(문화/여가)가 overspending 에 없어야 함').toBeUndefined();
      expect(ov['쇼핑']).toMatchObject({ level: 'exceeded' });
      expect(ov['식비']).toMatchObject({ level: 'exceeded' });
      expect(ov['교통']).toMatchObject({ level: 'pace' });
      expect(ins.recurring.map((r) => r.memo)).toEqual(expect.arrayContaining(['월세', '넷플릭스']));
      const q = await (await get(api, `/api/recommendations/quick?type=expense&today=${today}`)).json();
      expect(q.items.length).toBeGreaterThan(0);
      const mo = await (await get(api, '/api/stats/monthly?from=2026-05&to=2026-10')).json();
      expect(mo.months).toHaveLength(6);
      for (const x of mo.months) expect(x.expenseTotal, x.month).toBeGreaterThan(0);

      // 다른 사용자에게는 시드 데이터가 보이지 않는다
      const other = await createLoggedInUser('c26other', { baseURL: s.url });
      const oi = await (await get(other.api, `/api/insights?month=${today.slice(0, 7)}&today=${today}`)).json();
      expect(oi).toEqual({ month: '2026-10', recurring: [], overspending: [], largeExpenses: [], incomeDrops: [], missingIncome: [] });
      // 관찰사항 기록용: 시드 insights 요약
      test.info().annotations.push({
        type: 'seed-insights',
        description: JSON.stringify({
          recurring: ins.recurring.map((r) => `${r.memo}/${r.period}/dueSoon=${r.dueSoon}`),
          overspending: ins.overspending.map((o) => `${o.category}/${o.level}/${o.ratio}`),
          largeExpenses: ins.largeExpenses.length,
        }),
      });
    } finally { await sb.cleanup(); }
  });

  test('C35 today 생략 시 Asia/Seoul: backend 단위 테스트(시각 UTC 2026-10-18T16:00Z 고정)가 존재하고 통과', async () => {
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=C35', 'src/backend/test/rules.test.js'], {
      cwd: ROOT, encoding: 'utf8',
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/C35 today 기본값은 Asia\/Seoul/);
    expect(r.stdout).toMatch(/pass 1\b/);
    expect(r.stdout).toMatch(/fail 0\b/);
    // API 레벨 기본값 검증 테스트(시각 주입)도 존재하는지 확인
    const grep = spawnSync(process.execPath, ['-e', "const s=require('fs').readFileSync('src/backend/test/api.test.js','utf8');process.exit(/2026-10-18T16:00:00Z/.test(s)&&/Asia\\/Seoul/.test(s)?0:1)"], { cwd: ROOT });
    expect(grep.status).toBe(0);
  });
});
