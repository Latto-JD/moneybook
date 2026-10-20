// plan 9.4 인증/보안 (C36~C48) + C1, C46
// 계약: docs/api.md 1~2장
import { test, expect } from '@playwright/test';
import { newApi, json, get, signup, login, setCookieHeader, createLoggedInUser } from '../helpers/api.js';
import { newAccount, PASSWORD } from '../helpers/accounts.js';
import { expectError } from '../helpers/errors.js';
import { IS_HTTPS, BASE_URL } from '../helpers/env.js';
import { qaOp } from '../helpers/server.js';

// 메인 서버가 QA_TOOLS=true 로 떠 있어야 동작하는 항목(C40 시각 조정, C43 만료)에서 사용
async function qaMain(op, query) {
  const r = await qaOp(BASE_URL, op, query);
  test.skip(r.status === 404, 'QA_TOOLS=true 서버가 아님');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

function cookieHeaderOf(state) {
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

test.describe('C1/C46 health, 보안 헤더', () => {
  test('C1 GET /api/health 200 {status:ok, db:ok}', async () => {
    const api = await newApi();
    const res = await get(api, '/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  for (const path of ['/', '/login.html', '/api/health']) {
    test(`C46 보안 헤더 ${path}`, async () => {
      const api = await newApi();
      const res = await get(api, path);
      const h = res.headers();
      expect(h['content-security-policy']).toContain("default-src 'self'");
      expect(h['content-security-policy']).toContain("object-src 'none'");
      expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('same-origin');
      if (path.startsWith('/api/')) expect(h['cache-control']).toContain('no-store');
    });
  }
});

test.describe('C36 가입', () => {
  test('C36 가입 201, 쿠키 속성, 비밀번호/해시 미노출', async () => {
    const acc = newAccount('c36');
    const api = await newApi();
    const res = await signup(api, acc);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.user).toEqual({ id: expect.any(String), email: acc.email });
    expect(JSON.stringify(body)).not.toMatch(/password|hash|scrypt/i);
    const sc = setCookieHeader(res);
    expect(sc).toMatch(/mb_sid=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//i);
    expect(sc).toMatch(/Max-Age=2592000/i);
    if (IS_HTTPS) expect(sc).toMatch(/Secure/i); // P3
  });
});

test.describe('C37 가입 검증', () => {
  for (const email of ['a@b', 'ab.com', 'a b@ex.com']) {
    test(`C37 잘못된 이메일 "${email}" -> 400`, async () => {
      const api = await newApi();
      await expectError(await signup(api, { email, password: PASSWORD }), 400, 'VALIDATION_ERROR');
    });
  }
  for (const [label, pw] of [['7자', 'a'.repeat(7)], ['129자', 'a'.repeat(129)]]) {
    test(`C37 비밀번호 ${label} -> 400`, async () => {
      const api = await newApi();
      await expectError(await signup(api, { email: newAccount('c37').email, password: pw }), 400, 'VALIDATION_ERROR');
    });
  }
  for (const [label, pw] of [['8자', 'a'.repeat(8)], ['128자', 'a'.repeat(128)]]) {
    test(`C37 비밀번호 ${label} -> 201`, async () => {
      const api = await newApi();
      expect((await signup(api, { email: newAccount('c37').email, password: pw })).status()).toBe(201);
    });
  }
  test('C37 대소문자만 다른 동일 이메일 -> 409 EMAIL_TAKEN', async () => {
    const acc = newAccount('c37dup');
    const mixed = acc.email.replace('qa+', 'QA+').replace('@example.com', '@Example.com');
    expect((await signup(await newApi(), { email: mixed, password: PASSWORD })).status()).toBe(201);
    await expectError(await signup(await newApi(), { email: mixed.toLowerCase(), password: PASSWORD }), 409, 'EMAIL_TAKEN');
  });
  // C37 SIGNUP_ENABLED=false 는 managed.spec.js (서버를 직접 띄움)
});

test.describe('C39 로그인', () => {
  test('C39 정상 200+쿠키, 대소문자 무시, 실패는 동일 code/message', async () => {
    const acc = newAccount('c39');
    await signup(await newApi(), acc);

    const ok = await login(await newApi(), acc);
    expect(ok.status()).toBe(200);
    expect(setCookieHeader(ok)).toMatch(/mb_sid=/);

    const upper = await login(await newApi(), { email: acc.email.toUpperCase(), password: acc.password });
    expect(upper.status()).toBe(200);

    const wrongPw = await expectError(await login(await newApi(), { email: acc.email, password: 'wrong-password' }), 401, 'INVALID_CREDENTIALS');
    const noUser = await expectError(await login(await newApi(), newAccount('nouser')), 401, 'INVALID_CREDENTIALS');
    expect(noUser).toEqual(wrongPw);
  });
});

test.describe('C40 시도 제한', () => {
  test('C40 같은 이메일 실패 5회 후 6번째는 정답이어도 429 + Retry-After', async () => {
    const acc = newAccount('c40');
    await signup(await newApi(), acc);
    for (let i = 0; i < 5; i++) {
      await expectError(await login(await newApi(), { email: acc.email, password: 'bad-password' }), 401);
    }
    const res = await login(await newApi(), acc);
    await expectError(res, 429, 'TOO_MANY_ATTEMPTS');
    expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
  });
  test('C40 실패 기록 시각을 16분 전으로 조정하면 다시 로그인 가능', async () => {
    const acc = newAccount('c40age');
    await signup(await newApi(), acc);
    for (let i = 0; i < 5; i++) await login(await newApi(), { email: acc.email, password: 'bad-password' });
    await expectError(await login(await newApi(), acc), 429, 'TOO_MANY_ATTEMPTS');
    const r = await qaMain('age-attempts', { minutes: '16', email: acc.email });
    expect(r.updated).toBeGreaterThanOrEqual(5);
    expect((await login(await newApi(), acc)).status()).toBe(200);
  });
  test('C40 실패 3회 후 성공하면 카운트 초기화', async () => {
    const acc = newAccount('c40reset');
    await signup(await newApi(), acc);
    for (let i = 0; i < 3; i++) await login(await newApi(), { email: acc.email, password: 'bad-password' });
    expect((await login(await newApi(), acc)).status()).toBe(200);
    // 초기화됐다면 4회 더 실패해도 429 가 아니어야 한다(초기화 안 됐으면 총 7회라 429)
    for (let i = 0; i < 4; i++) {
      expect((await login(await newApi(), { email: acc.email, password: 'bad-password' })).status()).toBe(401);
    }
  });
});

// C41 IP 제한은 managed.spec.js (TRUST_PROXY=true 서버를 직접 띄움)

test.describe('C42 로그아웃', () => {
  test('C42 204 + Max-Age=0, 이전 쿠키 재사용 시 me 401', async () => {
    const { api, user } = await createLoggedInUser('c42');
    const me = await get(api, '/api/auth/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).user.email).toBe(user.email);

    const cookie = (await api.storageState()).cookies.find((c) => c.name === 'mb_sid');
    expect(cookie).toBeTruthy();

    const out = await json(api, 'POST', '/api/auth/logout');
    expect(out.status()).toBe(204);
    expect(setCookieHeader(out)).toMatch(/Max-Age=0/i);

    const replay = await newApi({ extraHeaders: { Cookie: `mb_sid=${cookie.value}` } });
    await expectError(await get(replay, '/api/auth/me'), 401, 'UNAUTHENTICATED');
  });
});

const VALID_TX = { type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-10-01' };
const ZERO_ID = '00000000-0000-4000-8000-000000000000';
const PROTECTED = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/categories'],
  ['POST', '/api/categories', { type: 'expense', name: '반려동물' }],
  ['PATCH', `/api/categories/${ZERO_ID}`, { active: false }],
  ['GET', '/api/transactions?month=2026-10'],
  ['POST', '/api/transactions', VALID_TX],
  ['PUT', `/api/transactions/${ZERO_ID}`, VALID_TX],
  ['DELETE', `/api/transactions/${ZERO_ID}`],
  ['GET', '/api/summary?month=2026-10'],
  ['GET', '/api/stats/monthly?from=2026-10&to=2026-10'],
  ['GET', '/api/stats/categories?from=2026-10&to=2026-10'],
  ['GET', '/api/stats/category-monthly?from=2026-10&to=2026-10'],
  ['GET', '/api/recommendations/quick?type=expense'],
  ['GET', '/api/recommendations/autocomplete?q=a&type=expense'],
  ['GET', '/api/insights?month=2026-10'],
];

test.describe('C43 인증 필요', () => {
  for (const [method, url, body] of PROTECTED) {
    test(`C43 쿠키 없음 ${method} ${url} -> 401`, async () => {
      await expectError(await json(await newApi(), method, url, body), 401, 'UNAUTHENTICATED');
    });
    test(`C43 임의 쿠키 ${method} ${url} -> 401`, async () => {
      const api = await newApi({ extraHeaders: { Cookie: 'mb_sid=not-a-real-token' } });
      await expectError(await json(api, method, url, body), 401, 'UNAUTHENTICATED');
    });
  }
  test('C43 만료된 세션(expires_at 과거)으로 전 보호 API -> 401', async () => {
    const { api, account } = await createLoggedInUser('c43exp');
    expect((await get(api, '/api/auth/me')).status()).toBe(200); // 만료 전에는 정상
    const r = await qaMain('expire-sessions', { email: account.email });
    expect(r.updated).toBe(1);
    for (const [method, url, body] of PROTECTED) {
      await expectError(await json(api, method, url, body), 401, 'UNAUTHENTICATED');
    }
    expect((await get(api, '/api/health')).status()).toBe(200);
  });
  test('C43 /api/health 는 인증 없이 200', async () => {
    expect((await get(await newApi(), '/api/health')).status()).toBe(200);
  });
});

test.describe('C44 CSRF', () => {
  const tx = { ...VALID_TX, memo: 'csrf' };

  test('C44 POST transactions: Origin 없음 403, 타 Origin 403', async () => {
    const { api } = await createLoggedInUser('c44');
    const Cookie = cookieHeaderOf(await api.storageState());
    const noOrigin = await newApi({ withOrigin: false, extraHeaders: { Cookie } });
    await expectError(await json(noOrigin, 'POST', '/api/transactions', tx), 403, 'CSRF_REJECTED');
    const evil = await newApi({ withOrigin: false, extraHeaders: { Cookie, Origin: 'https://evil.example' } });
    await expectError(await json(evil, 'POST', '/api/transactions', tx), 403, 'CSRF_REJECTED');
  });

  for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
    test(`C44 올바른 Origin + ${ct} -> 415`, async () => {
      const { api } = await createLoggedInUser('c44ct');
      const res = await api.fetch('/api/transactions', {
        method: 'POST', headers: { 'Content-Type': ct }, data: JSON.stringify(tx), failOnStatusCode: false,
      });
      await expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    });
  }

  test('C44 로그인/가입/로그아웃/PUT/DELETE 도 Origin 없으면 403', async () => {
    const { api } = await createLoggedInUser('c44all');
    const Cookie = cookieHeaderOf(await api.storageState());
    const bare = await newApi({ withOrigin: false, extraHeaders: { Cookie } });
    const calls = [
      ['POST', '/api/auth/login', { email: 'x@example.com', password: PASSWORD }],
      ['POST', '/api/auth/signup', newAccount('c44')],
      ['POST', '/api/auth/logout', undefined],
      ['PUT', `/api/transactions/${ZERO_ID}`, tx],
      ['DELETE', `/api/transactions/${ZERO_ID}`, undefined],
    ];
    for (const [m, u, b] of calls) {
      await expectError(await json(bare, m, u, b), 403, 'CSRF_REJECTED');
    }
  });
});

test.describe('C45/C47/C48 기타', () => {
  test('C45 본문 16KB 초과 -> 413', async () => {
    const { api } = await createLoggedInUser('c45');
    const res = await json(api, 'POST', '/api/transactions', { ...VALID_TX, memo: 'x'.repeat(17 * 1024) });
    await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  test('C47 autocomplete q=작은따옴표 에 500 없음', async () => {
    const { api } = await createLoggedInUser('c47');
    const res = await get(api, `/api/recommendations/autocomplete?q=${encodeURIComponent("'")}&type=expense`);
    expect(res.status()).toBeLessThan(500);
  });

  // C48 은 managed.spec.js (break-db / 잘못된 DATABASE_URL 서버)
});

// C38 은 managed.spec.js (서버를 멈추고 DB 를 직접 조회)
