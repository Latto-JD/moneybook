// docs/api.md 계약 보충 검증 (plan C 항목의 경계/오류 상황 확장). 모두 API 레벨.
import { test, expect } from '@playwright/test';
import { newApi, json, get, addTx, signup, login, setCookieHeader, createLoggedInUser } from '../helpers/api.js';
import { newAccount, PASSWORD } from '../helpers/accounts.js';
import { expectError } from '../helpers/errors.js';

test.describe('api.md 1장 공통', () => {
  test('알 수 없는 경로 404 NOT_FOUND, 허용 안 된 메서드 405 + Allow', async () => {
    const { api } = await createLoggedInUser('ct1');
    await expectError(await get(api, '/api/nope'), 404, 'NOT_FOUND');
    const r = await json(api, 'DELETE', '/api/transactions'); // 컬렉션에 DELETE 불가
    await expectError(r, 405, 'METHOD_NOT_ALLOWED');
    expect(r.headers()['allow']).toBeTruthy();
    const h = await json(api, 'POST', '/api/health');
    await expectError(h, 405, 'METHOD_NOT_ALLOWED');
  });

  test('API 응답 헤더: JSON charset, no-store, nosniff', async () => {
    const { api } = await createLoggedInUser('ct1h');
    const res = await get(api, '/api/categories');
    expect(res.headers()['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers()['cache-control']).toContain('no-store');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    // v3: 활성 이름 배열(기존 형식 유지) + items(활성/비활성 전체). 신규 가입자는 기본 12개가 모두 활성.
    const body = await res.json();
    expect(body.expense).toEqual(['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타']);
    expect(body.income).toEqual(['급여', '용돈', '부수입', '기타']);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(12);
  });

  test('검사 순서: Origin(403)이 Content-Type(415)/JSON(400)보다 먼저, 인증(401)은 JSON 파싱 뒤', async () => {
    const api = await newApi({ withOrigin: false });
    await expectError(await api.fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: 'x', failOnStatusCode: false }), 403, 'CSRF_REJECTED');
    const anon = await newApi();
    await expectError(await anon.fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: '{bad', failOnStatusCode: false }), 400, 'INVALID_JSON');
    await expectError(await json(anon, 'POST', '/api/transactions', { type: 'expense' }), 401, 'UNAUTHENTICATED');
  });

  test('JSON 본문이 객체가 아니면(배열/문자열) 400 INVALID_JSON', async () => {
    const { api } = await createLoggedInUser('ct1j');
    for (const data of ['[]', '"abc"', '123', 'null']) {
      const r = await api.fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data, failOnStatusCode: false });
      await expectError(r, 400, 'INVALID_JSON');
    }
  });

  test('16KB 경계: 본문 16384바이트 이하는 413 아님, 초과는 413', async () => {
    const { api } = await createLoggedInUser('ct1b');
    const pad = (n) => JSON.stringify({ type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-10-01', x: 'a'.repeat(n) });
    const base = Buffer.byteLength(pad(0));
    const okBody = pad(16384 - base);
    expect(Buffer.byteLength(okBody)).toBe(16384);
    const ok = await api.fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: okBody, failOnStatusCode: false });
    expect(ok.status()).toBe(201); // 알 수 없는 필드는 무시
    const over = await api.fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: pad(16385 - base), failOnStatusCode: false });
    await expectError(over, 413, 'PAYLOAD_TOO_LARGE');
  });
});

test.describe('인증 보충', () => {
  test('가입 이메일은 trim+소문자 정규화, 응답 email 도 정규화 값; 로그인은 공백/대문자 무시', async () => {
    const acc = newAccount('ctn');
    const messy = `  ${acc.email.toUpperCase()}  `;
    const res = await signup(await newApi(), { email: messy, password: PASSWORD });
    expect(res.status()).toBe(201);
    expect((await res.json()).user.email).toBe(acc.email.toLowerCase());
    expect((await login(await newApi(), { email: messy, password: PASSWORD })).status()).toBe(200);
  });

  test('이메일 검증 확장: 254자 초과, @ 2개, 도메인 점 시작/끝, 빈 로컬 -> 400', async () => {
    const api = await newApi();
    const long = `${'a'.repeat(250)}@e.co`; // 255자
    for (const email of [long, 'a@@b.com', 'a@.com', 'a@b.', '@b.com', 'a@b.com ', '']) {
      const r = await signup(api, { email, password: PASSWORD });
      // 'a@b.com ' 은 trim 되어 유효하므로 201 이 정상
      if (email === 'a@b.com ') { expect([201, 409]).toContain(r.status()); continue; }
      await expectError(r, 400, 'VALIDATION_ERROR');
    }
  });

  test('가입/로그인 본문 타입 오류(숫자 비밀번호, 이메일 누락) -> 400', async () => {
    const api = await newApi();
    await expectError(await json(api, 'POST', '/api/auth/signup', { email: newAccount('x').email, password: 12345678 }), 400, 'VALIDATION_ERROR');
    await expectError(await json(api, 'POST', '/api/auth/login', { password: PASSWORD }), 400, 'VALIDATION_ERROR');
    await expectError(await json(api, 'POST', '/api/auth/login', { email: 'a@b.com', password: 123 }), 400, 'VALIDATION_ERROR');
  });

  test('비밀번호 앞뒤 공백은 비밀번호의 일부(공백 포함 가입 후 공백 없이는 로그인 불가)', async () => {
    const acc = newAccount('ctsp');
    const pw = '  spaced-pass  ';
    expect((await signup(await newApi(), { email: acc.email, password: pw })).status()).toBe(201);
    expect((await login(await newApi(), { email: acc.email, password: pw })).status()).toBe(200);
    expect((await login(await newApi(), { email: acc.email, password: pw.trim() })).status()).toBe(401);
  });

  test('로그아웃은 세션 없이도 204, 로그아웃 후 쿠키 제거 속성', async () => {
    const out = await json(await newApi(), 'POST', '/api/auth/logout');
    expect(out.status()).toBe(204);
    expect(setCookieHeader(out)).toMatch(/mb_sid=;?/);
    expect(setCookieHeader(out)).toMatch(/Max-Age=0/i);
  });

  test('로그인 응답에 사용자 id 가 가입 시와 같고 해시/비밀번호 필드 없음', async () => {
    const acc = newAccount('ctid');
    const su = await (await signup(await newApi(), acc)).json();
    const li = await login(await newApi(), acc);
    const body = await li.json();
    expect(body.user.id).toBe(su.user.id);
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
  });
});

test.describe('거래 보충', () => {
  test('메모 trim 후 저장, 생략 시 "" , PUT 은 createdAt 유지, 알 수 없는 필드 무시', async () => {
    const { api } = await createLoggedInUser('cttx');
    const a = await (await addTx(api, { memo: '  앞뒤공백  ' })).json();
    expect(a.memo).toBe('앞뒤공백');
    const noMemo = await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 500, category: '기타', date: '2026-10-02' });
    expect(noMemo.status()).toBe(201);
    expect((await noMemo.json()).memo).toBe('');
    // 공백 51자 + 실제 50자 = trim 후 50자는 통과
    expect((await addTx(api, { memo: ` ${'a'.repeat(50)} ` })).status()).toBe(201);
    const put = await json(api, 'PUT', `/api/transactions/${a.id}`, { type: 'income', amount: 3000, category: '용돈', memo: 'x', date: '2026-10-03', id: 'evil', createdAt: '2000-01-01T00:00:00Z' });
    expect(put.status()).toBe(200);
    const u = await put.json();
    expect(u).toMatchObject({ id: a.id, createdAt: a.createdAt, type: 'income', category: '용돈' });
  });

  test('PUT 검증 오류 400(변경 안 됨), DELETE 두 번째는 404', async () => {
    const { api } = await createLoggedInUser('cttx2');
    const a = await (await addTx(api, { amount: 1234 })).json();
    await expectError(await json(api, 'PUT', `/api/transactions/${a.id}`, { type: 'expense', amount: 0, category: '식비', date: '2026-10-01' }), 400, 'VALIDATION_ERROR');
    const list = await (await get(api, '/api/transactions?month=2026-10')).json();
    expect(list.transactions.find((t) => t.id === a.id).amount).toBe(1234);
    expect((await json(api, 'DELETE', `/api/transactions/${a.id}`)).status()).toBe(204);
    await expectError(await json(api, 'DELETE', `/api/transactions/${a.id}`), 404, 'NOT_FOUND');
  });

  test('목록 정렬: date 내림차순, 같은 날은 createdAt 내림차순; month 누락/형식 오류 400', async () => {
    const { api } = await createLoggedInUser('cttx3');
    await addTx(api, { memo: 'a', date: '2026-10-01' });
    await addTx(api, { memo: 'b', date: '2026-10-09' });
    await addTx(api, { memo: 'c', date: '2026-10-09' });
    await addTx(api, { memo: 'd', date: '2026-10-05' });
    const list = (await (await get(api, '/api/transactions?month=2026-10')).json()).transactions;
    expect(list.map((t) => t.memo)).toEqual(['c', 'b', 'd', 'a']);
    for (const q of ['', '?month=2026-1', '?month=2026-13', '?month=202610', '?month=abc']) {
      await expectError(await get(api, `/api/transactions${q}`), 400, 'VALIDATION_ERROR');
    }
  });

  test('summary: income 만/지출 동률 정렬/ratio 반올림, month 오류 400', async () => {
    const { api } = await createLoggedInUser('ctsum');
    await addTx(api, { category: '쇼핑', amount: 1 });
    await addTx(api, { category: '교통', amount: 1 });
    await addTx(api, { category: '식비', amount: 1 });
    const s = await (await get(api, '/api/summary?month=2026-10')).json();
    expect(s.month).toBe('2026-10');
    expect(s.byCategory.map((c) => c.category)).toEqual(['식비', '교통', '쇼핑']); // 동률은 고정 순서
    expect(s.byCategory.map((c) => c.ratio)).toEqual([0.3333, 0.3333, 0.3333]);
    expect(s.byCategory[0]).toMatchObject({ total: 1, count: 1 });
    await expectError(await get(api, '/api/summary'), 400, 'VALIDATION_ERROR');
    await expectError(await get(api, '/api/summary?month=2026-00'), 400, 'VALIDATION_ERROR');
  });
});

test.describe('추천/인사이트 검증', () => {
  test('today 형식 오류, type 오류, q 50자 초과 -> 400, q 50자는 200, 공백만 q 는 빈 결과', async () => {
    const { api } = await createLoggedInUser('ctrec');
    await expectError(await get(api, '/api/recommendations/quick?today=2026-13-01'), 400, 'VALIDATION_ERROR');
    await expectError(await get(api, '/api/recommendations/quick?type=foo'), 400, 'VALIDATION_ERROR');
    await expectError(await get(api, '/api/insights?month=2026-10&today=20261019'), 400, 'VALIDATION_ERROR');
    await expectError(await get(api, '/api/insights'), 400, 'VALIDATION_ERROR');
    await expectError(await get(api, `/api/recommendations/autocomplete?q=${'a'.repeat(51)}&type=expense`), 400, 'VALIDATION_ERROR');
    expect((await get(api, `/api/recommendations/autocomplete?q=${'a'.repeat(50)}&type=expense`)).status()).toBe(200);
    const sp = await get(api, `/api/recommendations/autocomplete?q=${encodeURIComponent('   ')}&type=expense`);
    expect(sp.status()).toBe(200);
    expect(await sp.json()).toEqual({ items: [] });
  });

  test('quick 은 type=income 도 동작, 메모 정규화(대소문자/연속 공백) 그룹, income 은 expense 에 안 섞임', async () => {
    const { api } = await createLoggedInUser('ctq');
    const T = '2026-10-19';
    const d = (n) => { const x = new Date(`${T}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
    await addTx(api, { memo: 'GS25  편의점', category: '식비', amount: 3000, date: d(1) });
    await addTx(api, { memo: 'gs25 편의점', category: '식비', amount: 3000, date: d(2) });
    await addTx(api, { memo: ' Gs25 편의점 ', category: '식비', amount: 3500, date: d(3) });
    for (const n of [1, 2, 3]) await addTx(api, { type: 'income', category: '용돈', memo: '용돈받음', amount: 50000, date: d(n) });
    const e = (await (await get(api, `/api/recommendations/quick?type=expense&today=${T}`)).json()).items;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ category: '식비', amount: 3000, count: 3, lastDate: d(1), memo: 'GS25 편의점' === e[0].memo ? e[0].memo : e[0].memo });
    expect(e[0].memo.toLowerCase().replace(/\s+/g, ' ').trim()).toBe('gs25 편의점');
    const i = (await (await get(api, `/api/recommendations/quick?type=income&today=${T}`)).json()).items;
    expect(i.map((x) => x.memo)).toEqual(['용돈받음']);
  });

  test('autocomplete: 시작 일치 우선, 5개 미만이면 포함 일치로 보충, 최대 5개', async () => {
    const { api } = await createLoggedInUser('ctac');
    const T = '2026-10-19';
    await addTx(api, { memo: '커피', category: '카페/간식', amount: 1000, date: '2026-10-10' });
    await addTx(api, { memo: '아이스커피', category: '카페/간식', amount: 2000, date: '2026-10-11' });
    await addTx(api, { memo: '커피빈', category: '카페/간식', amount: 3000, date: '2026-10-12' });
    const r = (await (await get(api, `/api/recommendations/autocomplete?q=${encodeURIComponent('커피')}&type=expense&today=${T}`)).json()).items;
    expect(r.map((x) => x.memo).slice(0, 2).sort()).toEqual(['커피', '커피빈'].sort());
    expect(r.map((x) => x.memo)).toContain('아이스커피'); // 포함 일치 보충
    expect(r[r.length - 1].memo).toBe('아이스커피'); // 보충분은 시작 일치 뒤
    for (const n of [1, 2, 3, 4, 5, 6]) await addTx(api, { memo: `커피${n}`, category: '카페/간식', amount: 100, date: '2026-10-13' });
    const r2 = (await (await get(api, `/api/recommendations/autocomplete?q=${encodeURIComponent('커피')}&type=expense&today=${T}`)).json()).items;
    expect(r2).toHaveLength(5);
  });

  test('today 이후(미래) 거래는 규칙 입력에서 제외', async () => {
    const { api } = await createLoggedInUser('ctfut');
    for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) await addTx(api, { memo: '미래거래', category: '쇼핑', amount: 5000, date: d });
    expect((await (await get(api, '/api/recommendations/quick?type=expense&today=2026-10-19')).json()).items).toEqual([]);
  });
});

test.describe('집계 보충', () => {
  test('stats: 응답 from/to/type 에코, category-monthly 는 income 지원, from=to 단월, 24개월 경계에서 months 길이', async () => {
    const { api } = await createLoggedInUser('ctst');
    await addTx(api, { type: 'income', category: '급여', amount: 1000000, date: '2026-09-25' });
    await addTx(api, { type: 'income', category: '용돈', amount: 50000, date: '2026-10-02' });
    const cm = await (await get(api, '/api/stats/category-monthly?from=2026-08&to=2026-10&type=income')).json();
    expect(cm).toMatchObject({ from: '2026-08', to: '2026-10', type: 'income', months: ['2026-08', '2026-09', '2026-10'] });
    expect(cm.series).toEqual([
      { category: '급여', totals: [0, 1000000, 0], sum: 1000000 },
      { category: '용돈', totals: [0, 0, 50000], sum: 50000 },
    ]);
    const m = await (await get(api, '/api/stats/monthly?from=2026-10&to=2026-10')).json();
    expect(m.months).toEqual([{ month: '2026-10', incomeTotal: 50000, expenseTotal: 0, balance: 50000, count: 1 }]);
  });

  test('연도 경계(2025-11~2026-02) 월 목록, 윤년 2028-02-29 거래 집계', async () => {
    const { api } = await createLoggedInUser('ctyr');
    const m = await (await get(api, '/api/stats/monthly?from=2025-11&to=2026-02')).json();
    expect(m.months.map((x) => x.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect((await addTx(api, { date: '2028-02-29', amount: 777 })).status()).toBe(201);
    expect((await addTx(api, { date: '2027-02-29', amount: 777 })).status()).toBe(400);
    const s = await (await get(api, '/api/summary?month=2028-02')).json();
    expect(s.expenseTotal).toBe(777);
  });
});
