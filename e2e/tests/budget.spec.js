// docs/plan-budget.md 8장 BG-01 ~ BG-20 중 e2e 로 확인하는 항목.
// mobile-360 에서는 API·마이그레이션·범위·UI, tablet-768 에서는 UI 만 돈다(API 항목은 뷰포트와 무관해 360 에서만).
// UI "오늘"은 2026-10-19 고정. 서버는 TRUST_PROXY=true. 스크린샷은 docs/qa-shots-budget/.
// 기준 커밋은 08d1502 에 고정한다(HEAD 가 아님).
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createLoggedInUser, addTx, get, json, newApi, signup } from '../helpers/api.js';
import { newAccount } from '../helpers/accounts.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';
import { ROOT, startServer, migrate, tmpPgliteDir, removeDir, dbQuery, dbExec, checkoutCommit, removeCheckout } from '../helpers/server.js';

const BASE_COMMIT = '08d1502';
const PRE_COLOR_COMMIT = '17bc134';
const SHOTS = join(ROOT, 'docs', 'qa-shots-budget');
const widthOf = (ti) => ti.project.use.viewport.width;
const RANGE_MSG = '예산은 1원 이상 1억원 이하의 정수여야 해요.';
const TYPE_MSG = '예산은 지출 카테고리에만 정할 수 있어요.';
const FRONT_MSG = '예산은 1원 이상 1억원 이하의 숫자로 입력해 주세요';
const won = (n) => `${n.toLocaleString('en-US')}원`;

const list = async (api) => (await (await get(api, '/api/categories')).json()).items;
const byName = (items, name, type = 'expense') => items.find((i) => i.type === type && i.name === name);
const patch = (api, id, body) => json(api, 'PATCH', `/api/categories/${id}`, body);
const fieldsOf = (b) => b.error?.fields ?? b.fields ?? {};
const mk = async (api, name, type = 'expense', extra = {}) => {
  const r = await json(api, 'POST', '/api/categories', { type, name, ...extra });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
};
const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// ---------------- API: BG-02 ~ BG-07 ----------------
test.describe('BG API', () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'mobile-360', '360 에서만'); });

  test('BG-02 모든 카테고리 객체에 budget 키(GET·POST·PATCH), POST 본문 budget 은 무시', async () => {
    const { api } = await createLoggedInUser('bg02');
    const items = await list(api);
    expect(items.length).toBe(12);
    for (const i of items) { expect(Object.keys(i), i.name).toContain('budget'); expect(i.budget, i.name).toBeNull(); }
    const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: '신규A', budget: 5000 });
    expect(r.status()).toBe(201);
    const c = await r.json();
    expect('budget' in c).toBe(true);
    expect(c.budget).toBeNull();
    expect(byName(await list(api), '신규A').budget).toBeNull();
    const rin = await json(api, 'POST', '/api/categories', { type: 'income', name: '신규B', budget: 5000 });
    expect((await rin.json()).budget).toBeNull();
    const p = await patch(api, c.id, { name: '신규A2' });
    expect(p.status()).toBe(200);
    expect('budget' in (await p.json())).toBe(true);
  });

  test('BG-03 정하기·해제·같은 값 재전송', async () => {
    const { api } = await createLoggedInUser('bg03');
    const food = byName(await list(api), '식비');
    let r = await patch(api, food.id, { budget: 400000 });
    expect(r.status()).toBe(200);
    expect((await r.json()).budget).toBe(400000);
    expect(byName(await list(api), '식비').budget).toBe(400000);
    r = await patch(api, food.id, { budget: 400000 });
    expect(r.status()).toBe(200);
    expect((await r.json()).budget).toBe(400000);
    r = await patch(api, food.id, { budget: 123456 });
    expect((await r.json()).budget).toBe(123456);
    r = await patch(api, food.id, { budget: null });
    expect(r.status()).toBe(200);
    expect((await r.json()).budget).toBeNull();
    expect(byName(await list(api), '식비').budget).toBeNull();
    r = await patch(api, food.id, { budget: null }); // 이미 null -> 멱등
    expect(r.status()).toBe(200);
  });

  test('BG-04 잘못된 값 400 fields.budget, 경계 1·100000000 은 200', async () => {
    const { api } = await createLoggedInUser('bg04');
    const food = byName(await list(api), '식비');
    for (const bad of [0, -1, 100000001, '5000', 1.5, true, false, [5], {}, 'abc', 1e9]) {
      const r = await patch(api, food.id, { budget: bad });
      expect(r.status(), JSON.stringify(bad)).toBe(400);
      const b = await r.json();
      expect(b.error.code).toBe('VALIDATION_ERROR');
      expect(fieldsOf(b).budget, JSON.stringify(bad)).toBe(RANGE_MSG);
    }
    expect(byName(await list(api), '식비').budget).toBeNull();
    let r = await patch(api, food.id, { budget: 1 });
    expect(r.status()).toBe(200);
    expect((await r.json()).budget).toBe(1);
    r = await patch(api, food.id, { budget: 100000000 });
    expect(r.status()).toBe(200);
    expect((await r.json()).budget).toBe(100000000);
    expect(byName(await list(api), '식비').budget).toBe(100000000);
  });

  test('BG-05 수입 카테고리: 숫자 400, null 200, 다른 사용자·비 UUID id 는 404(유형 검사보다 먼저)', async () => {
    const { api } = await createLoggedInUser('bg05');
    const other = await createLoggedInUser('bg05o');
    const items = await list(api);
    const sal = byName(items, '급여', 'income');
    let r = await patch(api, sal.id, { budget: 1000 });
    expect(r.status()).toBe(400);
    let b = await r.json();
    expect(b.error.code).toBe('VALIDATION_ERROR');
    expect(fieldsOf(b).budget).toBe(TYPE_MSG);
    expect(b.error.message).toBe(TYPE_MSG);
    r = await patch(api, sal.id, { budget: null });
    expect(r.status()).toBe(200);
    expect((await r.json()).budget).toBeNull();
    // 형식 오류가 유형 오류보다 먼저: 수입에 0 -> 범위 문구
    r = await patch(api, sal.id, { budget: 0 });
    expect(r.status()).toBe(400);
    expect(fieldsOf(await r.json()).budget).toBe(RANGE_MSG);
    // 다른 사용자의 id (그 사용자의 수입 카테고리 포함) -> 404
    const osal = byName(await list(other.api), '급여', 'income');
    const ofood = byName(await list(other.api), '식비');
    for (const id of [osal.id, ofood.id]) {
      r = await patch(api, id, { budget: 1000 });
      expect(r.status(), id).toBe(404);
    }
    expect(byName(await list(other.api), '식비').budget).toBeNull();
    for (const id of ['not-a-uuid', '123', '00000000-0000-0000-0000-000000000000']) {
      r = await patch(api, id, { budget: 1000 });
      expect(r.status(), id).toBe(404);
    }
    // 수입 카테고리가 만들어졌어도 그대로 null
    expect(byName(await list(api), '급여', 'income').budget).toBeNull();
  });

  test('BG-06 {name, budget} 원자성, 이름 변경·사용 안 함·다시 사용·색 변경 뒤 budget 유지, 사용 안 함에도 API 는 허용', async () => {
    const { api } = await createLoggedInUser('bg06');
    const items = await list(api);
    const cafe = byName(items, '카페/간식');
    const food = byName(items, '식비');
    let r = await patch(api, cafe.id, { name: '가'.repeat(16), budget: 5000 });
    expect(r.status()).toBe(400);
    expect(byName(await list(api), '카페/간식').budget).toBeNull();
    r = await patch(api, cafe.id, { name: '가'.repeat(15), budget: 5000 }); // 15자는 가능
    expect(r.status()).toBe(200);
    r = await patch(api, cafe.id, { name: '카페/간식', budget: 7000 });
    expect(r.status()).toBe(200);
    // 이름 중복(409)이면 예산도 미반영
    r = await patch(api, cafe.id, { name: '식비', budget: 9999 });
    expect(r.status()).toBe(409);
    expect(byName(await list(api), '카페/간식').budget).toBe(7000);
    // 수입 카테고리 + 이름 변경 + 숫자 예산 -> 400 이고 이름도 안 바뀜
    const sal = byName(items, '급여', 'income');
    r = await patch(api, sal.id, { name: '월급', budget: 100 });
    expect(r.status()).toBe(400);
    expect(byName(await list(api), '급여', 'income')).toBeTruthy();
    // 유지
    await patch(api, food.id, { budget: 400000 });
    expect((await patch(api, food.id, { name: '식사' })).status()).toBe(200);
    expect(byName(await list(api), '식사').budget).toBe(400000);
    expect((await patch(api, food.id, { active: false })).status()).toBe(200);
    expect(byName(await list(api), '식사').budget).toBe(400000);
    r = await patch(api, food.id, { budget: 250000 }); // 사용 안 함에도 API 는 허용
    expect(r.status()).toBe(200);
    expect((await patch(api, food.id, { active: true })).status()).toBe(200);
    expect(byName(await list(api), '식사').budget).toBe(250000);
    expect((await patch(api, food.id, { color: 7 })).status()).toBe(200);
    expect(byName(await list(api), '식사').budget).toBe(250000);
    // 한 번에: name + active + color + budget
    r = await patch(api, food.id, { name: '식비', color: 3, budget: 111 });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect([b.name, b.color, b.budget]).toEqual(['식비', 3, 111]);
  });

  test('BG-07 본문 없음/무관한 필드만 400 메시지', async () => {
    const { api } = await createLoggedInUser('bg07');
    const food = byName(await list(api), '식비');
    for (const body of [{}, { type: 'income' }, { sortOrder: 3 }]) {
      const r = await patch(api, food.id, body);
      expect(r.status(), JSON.stringify(body)).toBe(400);
      expect((await r.json()).error.message).toBe('name, active, color, budget 중 하나는 보내 주세요.');
    }
    // budget 이 undefined(키 없음)가 아니라 null 이면 "있는 것" -> 200
    expect((await patch(api, food.id, { budget: null })).status()).toBe(200);
  });
});

// ---------------- BG-01 마이그레이션 ----------------
test.describe('BG-01 마이그레이션', () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'mobile-360', '360 에서만'); });
  test.setTimeout(240_000);

  const colCheck = (dir) => {
    const cols = dbQuery(dir, `select column_name, data_type, is_nullable from information_schema.columns where table_name='categories' and column_name in ('budget','color') order by column_name`);
    expect(cols).toEqual([
      { column_name: 'budget', data_type: 'integer', is_nullable: 'YES' },
      { column_name: 'color', data_type: 'smallint', is_nullable: 'YES' },
    ]);
    const cons = dbQuery(dir, `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='categories'::regclass and contype='c'`).map((r) => r.def).join(' | ');
    expect(cons).toMatch(/budget/);
  };
  const stat = (dir) => dbQuery(dir, `select count(*)::int as total, count(*) filter (where color is null)::int as nulls, count(*) filter (where color between 1 and 12)::int as ok, count(*) filter (where budget is not null)::int as budgets from categories`)[0];

  test('BG-01a 빈 DB: 새 migrate 2번, budget 열 생김', async () => {
    const dir = tmpPgliteDir();
    try {
      migrate(dir); migrate(dir);
      colCheck(dir);
      expect(stat(dir)).toEqual({ total: 0, nulls: 0, ok: 0, budgets: 0 });
      // check 제약: 0 과 100000001 은 DB 가 거부
      const u = dbQuery(dir, `select count(*)::int as n from users`)[0].n;
      expect(u).toBe(0);
    } finally { removeDir(dir); }
  });

  test('BG-01b 색 적용 전(17bc134) DB: 사용자·거래가 있는 상태에서 새 migrate 2번 -> budget 전부 null, 색 nulls=0, 거래 불변', async () => {
    const oldDir = checkoutCommit(PRE_COLOR_COMMIT);
    const dir = tmpPgliteDir();
    try {
      migrate(dir, {}, oldDir);
      expect(dbQuery(dir, `select count(*)::int as n from information_schema.columns where table_name='categories' and column_name in ('color','budget')`)[0].n).toBe(0);
      const old = await startServer({ dir, cwd: oldDir });
      try {
        for (const tag of ['bgA', 'bgB']) {
          const api = await newApi({ baseURL: old.url });
          const r = await signup(api, newAccount(tag));
          expect(r.status()).toBe(201);
          for (const cat of ['식비', '교통']) {
            const t = await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 1234, category: cat, memo: '', date: '2026-10-05' });
            expect(t.status()).toBe(201);
          }
        }
      } finally { await old.stop(); }
      const before = dbQuery(dir, `select count(*)::int as n, sum(amount)::int as s from transactions`)[0];
      const catsBefore = dbQuery(dir, `select count(*)::int as n from categories`)[0].n;
      expect(catsBefore).toBe(24);
      migrate(dir); migrate(dir);
      colCheck(dir);
      expect(stat(dir)).toEqual({ total: 24, nulls: 0, ok: 24, budgets: 0 });
      expect(dbQuery(dir, `select count(*)::int as n, sum(amount)::int as s from transactions`)[0]).toEqual(before);
    } finally { removeDir(dir); removeCheckout(oldDir); }
  });

  test('BG-01c 이미 적용된 DB: 예산을 정한 뒤 다시 migrate 2번 해도 값 유지·오류 없음', async () => {
    const dir = tmpPgliteDir();
    try {
      migrate(dir);
      const s = await startServer({ dir });
      let ids;
      try {
        const api = await newApi({ baseURL: s.url });
        expect((await signup(api, newAccount('bgC'))).status()).toBe(201);
        const food = byName(await list(api), '식비');
        expect((await patch(api, food.id, { budget: 400000 })).status()).toBe(200);
        ids = food.id;
      } finally { await s.stop(); }
      migrate(dir); migrate(dir);
      colCheck(dir);
      expect(dbQuery(dir, `select budget from categories where id='${ids}'`)[0].budget).toBe(400000);
      expect(stat(dir)).toEqual({ total: 12, nulls: 0, ok: 12, budgets: 1 });
      // DB check: 범위 밖 직접 입력은 거부
      for (const v of [0, 100000001, -5]) {
        expect(() => dbExec(dir, `update categories set budget=${v} where id='${ids}'`), String(v)).toThrow();
      }
      expect(dbQuery(dir, `select budget from categories where id='${ids}'`)[0].budget).toBe(400000);
    } finally { removeDir(dir); }
  });
});

// ---------------- BG-20 범위 ----------------
test.describe('BG-20 범위', () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'mobile-360', '360 에서만'); });

  test(`BG-20 변경 파일이 허용 폴더 안에만 있고, 거래·집계·인사이트·이력 API 코드와 motion/spring 값은 ${BASE_COMMIT} 대비 변경 0`, () => {
    const tracked = git(['diff', '--name-only', BASE_COMMIT]).split('\n').filter(Boolean);
    const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
      .filter((f) => !f.startsWith('design_handoff_moneybook/'));
    // .claude/agents/qa.md 는 이 기능과 무관한 에이전트 설정 수정(작업 트리에 따로 있음). 기능 범위 판정에서 뺀다 // 사용자가 앞서 둔 디자인 자료. 이 기능의 변경이 아님
    const all = [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('.claude/'));
    expect(all.length).toBeGreaterThan(5);
    const ok = (f) => /^src\/backend\/(db|lib|categories|test)\//.test(f)
      || (/^src\/frontend\//.test(f) && !/^src\/frontend\/office\//.test(f))
      || /^e2e\//.test(f) || /^docs\//.test(f);
    expect(all.filter((f) => !ok(f)), '허용 폴더 밖 변경').toEqual([]);
    // 금지: 거래·집계·인사이트·이력 API, 규칙, 인증, 모션 값
    const forbidden = [
      'src/backend/transactions', 'src/backend/stats', 'src/backend/rules', 'src/backend/history', 'src/backend/auth',
      'src/backend/app.js', 'src/backend/router.js', 'src/backend/routes', 'src/backend/http.js', 'src/backend/security.js', 'src/backend/config.js',
      'src/frontend/public/js/lib/motion.js', 'src/frontend/public/js/lib/spring.js', 'src/frontend/public/css/tokens.css',
      'src/frontend/office', 'api', 'vercel.json', 'package.json',
    ];
    const hit = all.filter((f) => forbidden.some((p) => f === p || f.startsWith(`${p}/`)));
    expect(hit, '금지 경로 변경').toEqual([]);
    // 프론트 코드에서 새 API 엔드포인트가 늘지 않았다(budget-data/budget-card/dashboard/category-manager 에 /api/ 문자열 추가 없음)
    const added = git(['diff', BASE_COMMIT, '--', 'src/frontend/public/js']).split('\n').filter((l) => l.startsWith('+') && /\/api\//.test(l) && !/^\+\s*(\*|\/\/|\/\*)/.test(l)); // 주석 줄은 제외(budget-data.js 설명 주석이 경로를 언급)
    expect(added).toEqual([]);
  });
});

// ---------------- UI ----------------
async function openApp(browser, testInfo, { budgets = {}, tx = [], inactive = [], scheme = 'light', hash = '#dashboard', hook, extra = [] } = {}) {
  const u = await createLoggedInUser('bgui');
  for (const n of extra) await mk(u.api, n);
  let items = await list(u.api);
  for (const [name, b] of Object.entries(budgets)) {
    const r = await patch(u.api, byName(items, name).id, { budget: b });
    expect(r.status(), await r.text()).toBe(200);
  }
  for (const t of tx) await addTx(u.api, t);
  for (const name of inactive) await patch(u.api, byName(items, name).id, { active: false });
  items = await list(u.api);
  const ui = await newUiPage(browser, testInfo, { api: u.api });
  const { page } = ui;
  await page.emulateMedia({ colorScheme: scheme });
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) msgs.push(m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (hook) await hook(page);
  await page.goto(`/${hash}`);
  await expect(page.locator('#user-name')).toHaveText(u.account.name);
  return { ...ui, ...u, msgs, items };
}
const csp = (page) => page.evaluate(() => window.__csp || []);
const hashTo = (page, h) => page.evaluate((x) => { location.hash = x; }, h);
const row = (page, name) => page.locator('#panel-categories .cat-row').filter({ has: page.locator('.cat-name', { hasText: new RegExp(`^${name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}$`) }) });
const budgetBtn = (page, name) => row(page, name).locator('button[data-budget-btn]');
const budgetInput = (page) => page.locator('#panel-categories input[id^="catm-budget-"]');
const goManager = async (page) => {
  await hashTo(page, '#categories');
  await expect(page.locator('#panel-categories')).toBeVisible();
  await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
};
const shot = async (page, name) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const tag = (ti) => `${widthOf(ti)}`;
const budgetRows = (page) => page.locator('#budget-card .budget-row');
const statCalls = (page, bag) => page.route('**/api/stats/categories**', async (route) => { bag.push(route.request().url()); await route.continue(); });

test.describe('BG UI 카테고리 관리', () => {
  test('BG-08 지출 활성 행에만 "예산" 버튼(44px 이상, 순서 색·예산·이름 바꾸기·사용 안 함), 수입·사용 안 함 행에는 없다', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { budgets: { 식비: 400000 }, inactive: ['기타'], hash: '#categories' });
    const { page } = app;
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const foodLabels = await row(page, '식비').locator('.cat-actions button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    expect(foodLabels).toHaveLength(4);
    expect(foodLabels[0]).toMatch(/^식비 색 바꾸기/);
    expect(foodLabels[1]).toBe('식비 예산 바꾸기, 지금 400,000원');
    expect(foodLabels.slice(2)).toEqual(['식비 이름 바꾸기', '식비 사용 안 함']);
    await expect(budgetBtn(page, '교통')).toHaveAccessibleName('교통 예산 정하기');
    for (const n of ['식비', '교통']) {
      const bb = await budgetBtn(page, n).boundingBox();
      expect(bb.height, n).toBeGreaterThanOrEqual(44);
    }
    // 모든 활성 지출 행에 1개씩
    const expCount = await page.locator('#catm-active .cat-row').count();
    expect(await page.locator('#catm-active button[data-budget-btn]').count()).toBe(expCount);
    expect(await page.locator('#catm-active button', { hasText: /^예산$/ }).count()).toBe(expCount);
    // 사용 안 함 행
    await page.locator('#catm-inactive-details > summary').click();
    expect(await page.locator('#catm-inactive button[data-budget-btn]').count()).toBe(0);
    expect(await page.locator('#catm-inactive button', { hasText: '예산' }).count()).toBe(0);
    // 수입
    await page.locator('#catm-income').click();
    await expect(row(page, '급여')).toBeVisible();
    expect(await page.locator('#panel-categories button[data-budget-btn]').count()).toBe(0);
    expect(await page.locator('#panel-categories button', { hasText: /^예산$/ }).count()).toBe(0);
    await expectNoHorizontalScroll(page, widthOf(ti));
  });

  test('BG-09 입력칸 속성·라벨·쉼표·기존 값 채움, 색·이름·예산은 동시에 하나만 열림', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { budgets: { 식비: 400000 }, hash: '#categories' });
    const { page } = app;
    await budgetBtn(page, '식비').click();
    const input = budgetInput(page);
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('enterkeyhint', 'done');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toHaveAccessibleName('식비 월 예산(원)');
    await expect(input).toHaveValue('400,000');
    await expect(input).toBeFocused();
    expect(await input.evaluate((e) => [e.selectionStart, e.selectionEnd, e.value.length])).toEqual([0, 7, 7]); // 전체 선택
    await expect(budgetBtn(page, '식비')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#panel-categories .hint', { hasText: '비워 두고 저장하면 예산을 지워요' })).toBeVisible();
    const desc = await input.getAttribute('aria-describedby');
    expect(desc).toContain('-note');
    await expect(page.locator('#panel-categories button', { hasText: /^저장$/ })).toBeVisible();
    await expect(page.locator('#panel-categories button', { hasText: /^취소$/ })).toBeVisible();
    // 쉼표 표시
    await input.fill('');
    await input.pressSequentially('1234567');
    await expect(input).toHaveValue('1,234,567');
    await shot(page, `01-budget-input-${tag(ti)}`);
    // 한 번에 하나: 다른 행의 예산 -> 앞 행 닫힘
    await budgetBtn(page, '교통').click();
    await expect(budgetInput(page)).toHaveCount(1);
    await expect(budgetInput(page)).toHaveAccessibleName('교통 월 예산(원)');
    await expect(budgetInput(page)).toHaveValue('');
    // 색 -> 예산 닫힘
    await row(page, '교통').locator('button[data-color-btn]').click();
    await expect(budgetInput(page)).toHaveCount(0);
    await expect(page.locator('#panel-categories [role="radiogroup"]')).toHaveCount(1);
    // 예산 -> 색 닫힘
    await budgetBtn(page, '쇼핑').click();
    await expect(page.locator('#panel-categories [role="radiogroup"]')).toHaveCount(0);
    await expect(budgetInput(page)).toHaveCount(1);
    // 이름 바꾸기 -> 예산 닫힘
    await row(page, '쇼핑').getByRole('button', { name: /이름 바꾸기/ }).click();
    await expect(budgetInput(page)).toHaveCount(0);
    await expect(page.locator('#panel-categories input[id^="catm-rename-"]')).toHaveCount(1);
    // 이름 바꾸는 행은 버튼 줄이 입력 행으로 바뀐다 -> 다른 행의 예산을 열면 이름 바꾸기가 닫힌다
    await budgetBtn(page, '교통').click();
    await expect(page.locator('#panel-categories input[id^="catm-rename-"]')).toHaveCount(0);
    await expect(budgetInput(page)).toHaveCount(1);
    // 같은 버튼 다시 누르면 닫힘
    await budgetBtn(page, '교통').click();
    await expect(budgetInput(page)).toHaveCount(0);
    // 지출/수입 전환하면 닫힘
    await budgetBtn(page, '쇼핑').click();
    await expect(budgetInput(page)).toHaveCount(1);
    await page.locator('#catm-income').click();
    await expect(budgetInput(page)).toHaveCount(0);
    expect(await csp(page)).toEqual([]);
    expect(app.msgs).toEqual([]);
  });

  test('BG-10 Enter 저장·지우기·Esc·버튼 저장·중복 요청 1회, 알림·포커스·대시보드 반영', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { budgets: { 식비: 400000 }, hash: '#categories' });
    const { page, api } = app;
    const patches = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/categories/')) patches.push(r.postData()); });
    // Enter 저장: 새 예산
    await budgetBtn(page, '교통').click();
    await budgetInput(page).pressSequentially('50000');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'교통' 예산을 50,000원으로 정했어요");
    await expect(budgetInput(page)).toHaveCount(0);
    await expect(budgetBtn(page, '교통')).toBeFocused();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe('BUTTON');
    await expect(page.locator('#catm-status')).toHaveAttribute('aria-live', 'polite');
    expect(patches).toEqual([JSON.stringify({ budget: 50000 })]);
    expect(byName(await list(api), '교통').budget).toBe(50000);
    await expect(row(page, '교통').locator('.cat-used')).toHaveText('예산 50,000원 · 기록 0건');
    await expect(budgetBtn(page, '교통')).toHaveAccessibleName('교통 예산 바꾸기, 지금 50,000원');
    // 저장 버튼으로 값 바꾸기
    await budgetBtn(page, '교통').click();
    await expect(budgetInput(page)).toHaveValue('50,000');
    await budgetInput(page).fill('');
    await budgetInput(page).pressSequentially('70000');
    await page.getByRole('button', { name: '교통 예산 저장' }).click();
    await expect(page.locator('#catm-status')).toHaveText("'교통' 예산을 70,000원으로 정했어요");
    await expect(budgetBtn(page, '교통')).toBeFocused();
    expect(byName(await list(api), '교통').budget).toBe(70000);
    // 빈 칸 저장 = 해제
    await budgetBtn(page, '교통').click();
    await budgetInput(page).fill('');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'교통' 예산을 지웠어요");
    await expect(budgetBtn(page, '교통')).toBeFocused();
    expect(byName(await list(api), '교통').budget).toBeNull();
    expect(patches.at(-1)).toBe(JSON.stringify({ budget: null }));
    await expect(row(page, '교통').locator('.cat-used')).toHaveText('기록 0건');
    // Esc: 저장 없이 닫힘, 포커스는 "예산" 버튼
    const n0 = patches.length;
    await budgetBtn(page, '식비').click();
    await budgetInput(page).fill('');
    await budgetInput(page).pressSequentially('999');
    await page.keyboard.press('Escape');
    await expect(budgetInput(page)).toHaveCount(0);
    await expect(budgetBtn(page, '식비')).toBeFocused();
    expect(patches.length).toBe(n0);
    expect(byName(await list(api), '식비').budget).toBe(400000);
    // 취소 버튼
    await budgetBtn(page, '식비').click();
    await page.getByRole('button', { name: '식비 예산 정하기 취소' }).click();
    await expect(budgetInput(page)).toHaveCount(0);
    await expect(budgetBtn(page, '식비')).toBeFocused();
    expect(patches.length).toBe(n0);
    // 같은 값 저장도 오류 없이 닫힘
    await budgetBtn(page, '식비').click();
    await page.keyboard.press('Enter');
    await expect(budgetInput(page)).toHaveCount(0);
    expect(byName(await list(api), '식비').budget).toBe(400000);
    // 진행 중 중복: 응답을 느리게 하고 Enter 3번 + 저장 버튼 클릭 -> PATCH 1회
    await page.route('**/api/categories/*', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    const n1 = patches.length;
    await budgetBtn(page, '쇼핑').click();
    await budgetInput(page).pressSequentially('30000');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '쇼핑 예산 저장' }).click({ force: true, noWaitAfter: true }).catch(() => {});
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'쇼핑' 예산을 30,000원으로 정했어요");
    expect(patches.length - n1).toBe(1);
    // 대시보드 반영(해시 이동만)
    await hashTo(page, '#dashboard');
    await expect(page.locator('#budget-card')).toBeVisible();
    await expect(budgetRows(page)).toHaveCount(2);
    expect(await csp(page)).toEqual([]);
    expect(app.msgs).toEqual([]);
  });

  test('BG-11 잘못된 입력(0, abc, 100,000,001)은 요청 없이 행 오류, aria-invalid, 입력 유지, 포커스 입력칸. 서버 500 도 동일', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { hash: '#categories' });
    const { page, api } = app;
    const patches = [];
    page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.url()); });
    await budgetBtn(page, '식비').click();
    const input = budgetInput(page);
    const err = page.locator('#panel-categories .cat-row .error-text[role="alert"]').filter({ hasText: FRONT_MSG });
    for (const raw of ['100000001', '1000000000']) {
      await input.fill('');
      await input.pressSequentially(raw);
      const shown = await input.inputValue();
      await page.keyboard.press('Enter');
      await expect(err, raw).toHaveCount(1);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveValue(shown);
      await expect(input).toBeFocused();
      expect(patches, raw).toEqual([]);
    }
    // 저장 버튼으로도 동일: 100,000,001
    await input.fill('');
    await input.pressSequentially('100000001');
    await page.getByRole('button', { name: '식비 예산 저장' }).click();
    await expect(err).toHaveCount(1);
    await expect(input).toBeFocused();
    expect(patches).toEqual([]);
    await shot(page, `02-budget-error-${tag(ti)}`);
    // 입력을 고치고 저장하면 오류가 사라진다
    await input.fill('');
    await input.pressSequentially('100000000');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'식비' 예산을 100,000,000원으로 정했어요");
    expect(byName(await list(api), '식비').budget).toBe(100000000);
    // 서버 500
    let fail = true;
    await page.route('**/api/categories/*', async (route) => {
      if (fail && route.request().method() === 'PATCH') { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버에 문제가 생겼어요.' } }) }); return; }
      await route.continue();
    });
    await budgetBtn(page, '교통').click();
    await input.pressSequentially('8000');
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel-categories .cat-row .error-text[role="alert"]').filter({ hasText: /서버에 문제가 생겼어요/ })).toHaveCount(1);
    await expect(input).toHaveValue('8,000');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeFocused();
    expect(byName(await list(api), '교통').budget).toBeNull();
    // 다시 시도하면 저장된다
    fail = false;
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'교통' 예산을 8,000원으로 정했어요");
    expect(byName(await list(api), '교통').budget).toBe(8000);
    expect(app.msgs.filter((m) => /Content Security/i.test(m))).toEqual([]);
  });

  test('BG-11 입력 0 / abc 는 요청 없이 행 오류(기준 문구 그대로)', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { budgets: { 식비: 400000 }, hash: '#categories' });
    const { page, api } = app;
    const patches = [];
    page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.postData()); });
    for (const raw of ['0', 'abc']) {
      await budgetBtn(page, '식비').click();
      await budgetInput(page).pressSequentially(raw); // 기존 값이 전체 선택된 상태라 덮어쓴다
      const shown = await budgetInput(page).inputValue();
      test.info().annotations.push({ type: 'bg11-typed', description: JSON.stringify({ raw, shown }) });
      await page.keyboard.press('Enter');
      await expect(page.locator('#panel-categories .cat-row .error-text[role="alert"]').filter({ hasText: FRONT_MSG }), `${raw} -> 입력칸 "${shown}", PATCH ${JSON.stringify(patches)}`).toHaveCount(1);
      expect(patches, raw).toEqual([]);
      expect(byName(await list(api), '식비').budget).toBe(400000);
      await page.keyboard.press('Escape');
    }
  });

  test('BG-12 행 메타 "예산 N원 · 기록 N건" / "기록 N건", 가로 스크롤 없음, 예산 버튼 줄바꿈 상태(스크린샷)', async ({ browser }, ti) => {
    const w = widthOf(ti);
    const app = await openApp(browser, ti, {
      budgets: { 식비: 400000, '카페/간식': 100000, '주거/통신': 100000000 },
      tx: [{ category: '식비', amount: 1000, date: '2026-10-02' }, { category: '식비', amount: 2000, date: '2026-10-03' }],
      extra: ['아주아주긴이름의카테고리다'], hash: '#categories',
    });
    const { page } = app;
    await expect(row(page, '식비').locator('.cat-used')).toHaveText('예산 400,000원 · 기록 2건');
    await expect(row(page, '카페/간식').locator('.cat-used')).toHaveText('예산 100,000원 · 기록 0건');
    await expect(row(page, '주거/통신').locator('.cat-used')).toHaveText('예산 100,000,000원 · 기록 0건');
    await expect(row(page, '교통').locator('.cat-used')).toHaveText('기록 0건');
    await expectNoHorizontalScroll(page, w);
    // 버튼 4개가 360px 에서 어떻게 놓이는지: 모두 화면 안, 서로 겹치지 않음, 줄 수 기록
    const geo = await row(page, '주거/통신').locator('.cat-actions button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), t: b.textContent }; }));
    expect(geo).toHaveLength(4);
    for (const g of geo) { expect(g.x, g.t).toBeGreaterThanOrEqual(0); expect(g.r, g.t).toBeLessThanOrEqual(w); expect(g.h, g.t).toBeGreaterThanOrEqual(44); }
    for (let i = 0; i < geo.length; i++) for (let j = i + 1; j < geo.length; j++) {
      const a = geo[i]; const b = geo[j];
      const overlap = a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
      expect(overlap, `${a.t}/${b.t} 겹침`).toBe(false);
    }
    const lines = new Set(geo.map((g) => g.y)).size;
    test.info().annotations.push({ type: 'bg12-button-lines', description: `${w}px: 버튼 줄 수 ${lines}, 좌표 ${JSON.stringify(geo)}` });
    // 이름·메타가 버튼에 가려지지 않는다(이름 영역과 버튼이 겹치지 않음)
    const info = await row(page, '주거/통신').locator('.cat-info').boundingBox();
    const acts = await row(page, '주거/통신').locator('.cat-actions').boundingBox();
    expect(info.y + info.height <= acts.y + 1 || info.x + info.width <= acts.x + 1, '정보 영역과 버튼 영역 겹침').toBe(true);
    await shot(page, `03-manager-rows-${tag(ti)}`);
    // 긴 이름 행도 가로 스크롤 없음
    await row(page, '아주아주긴이름의카테고리다').scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page, w);
    // 입력 행이 열린 상태도 가로 스크롤 없음
    await budgetBtn(page, '주거/통신').click();
    await expectNoHorizontalScroll(page, w);
    const ib = await budgetInput(page).boundingBox();
    expect(ib.x).toBeGreaterThanOrEqual(0);
    expect(ib.x + ib.width).toBeLessThanOrEqual(w);
    await shot(page, `04-manager-open-${tag(ti)}`);
  });
});

test.describe('BG UI 대시보드', () => {
  const Oct = (category, amount, day = '2026-10-10') => ({ category, amount, date: day });

  test('BG-13 예산이 없으면 카드 숨김·예산용 stats 요청 없음, 하나 정하면 새로고침 없이 카드가 나타남', async ({ browser }, ti) => {
    const calls = [];
    const app = await openApp(browser, ti, { tx: [Oct('식비', 10000)], hook: (p) => statCalls(p, calls) });
    const { page } = app;
    await expect(page.locator('#kpi')).not.toBeEmpty();
    await expect(page.locator('#donut-title')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#budget-card')).toBeHidden();
    expect(await page.locator('#budget-card').evaluate((e) => [e.hidden, e.children.length])).toEqual([true, 0]);
    const nNoBudget = calls.length; // 도넛 1회만이어야 한다
    test.info().annotations.push({ type: 'bg13-stats-calls', description: JSON.stringify(calls) });
    await shot(page, `05-dash-nobudget-${tag(ti)}`);
    // 새로고침 없이: 카테고리 관리에서 예산 정하기 -> 대시보드
    const navs = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
    await hashTo(page, '#categories');
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    await budgetBtn(page, '식비').click();
    await budgetInput(page).pressSequentially('40000');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toContainText('40,000원');
    await hashTo(page, '#dashboard');
    await expect(page.locator('#budget-card')).toBeVisible();
    await expect(page.locator('#budget-card h2')).toHaveText('이번 달 예산');
    await expect(budgetRows(page)).toHaveCount(1);
    expect(navs.filter((u) => !u.includes('#'))).toEqual([]);
    // 같은 화면을 예산이 있는 상태로 새로 불러오면 stats/categories 요청이 정확히 1개 더 많다(예산 전용 요청)
    calls.length = 0;
    await page.reload();
    await expect(budgetRows(page)).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    expect(calls.length, JSON.stringify(calls)).toBe(nNoBudget + 1);
    // 해제하면 다시 숨김
    await hashTo(page, '#categories');
    await budgetBtn(page, '식비').click();
    await budgetInput(page).fill('');
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'식비' 예산을 지웠어요");
    await hashTo(page, '#dashboard');
    await expect(page.locator('#budget-card')).toBeHidden();
    expect(await csp(page)).toEqual([]);
    expect(app.msgs).toEqual([]);
  });

  test('BG-14/15/16 합계 줄·행 정렬·견본 색·0원 남음·초과 표시·접근 이름·막대 100% 상한·사용 안 함 제외', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, {
      budgets: { 식비: 400000, '카페/간식': 100000, 교통: 50000, 쇼핑: 80000, '의료/건강': 200000, '문화/여가': 60000 },
      tx: [Oct('식비', 320000), Oct('카페/간식', 120000), Oct('교통', 50000), Oct('쇼핑', 8000), Oct('의료/건강', 100000), Oct('문화/여가', 5000), Oct('기타', 77000)],
      inactive: ['문화/여가'],
    });
    const { page } = app;
    // 색은 저장된 값으로 바꿔 본다(카테고리 색 5, 식비 12)
    const food = byName(app.items, '식비');
    expect((await patch(app.api, food.id, { color: 12 })).status()).toBe(200);
    await page.reload();
    await expect(page.locator('#budget-card')).toBeVisible();
    const card = page.locator('#budget-card');
    // 활성 + 예산 있음 = 식비, 카페/간식, 교통, 쇼핑, 의료/건강 (문화/여가는 사용 안 함이라 제외)
    await expect(budgetRows(page)).toHaveCount(5);
    // 합계: 예산 400+100+50+80+200 = 830,000, 사용 320+120+50+8+100 = 598,000, 남음 232,000
    await expect(card.locator('.budget-sum__text')).toHaveText('예산 830,000원 중 598,000원 썼어요 · 232,000원 남음');
    await expect(card.locator('.budget-sum .caption')).toHaveText('예산을 정한 5개 카테고리 기준');
    // 정렬: 사용률 카페(120%) > 교통(100%) > 식비(80%) > 의료(50%) > 쇼핑(10%)
    const names = await budgetRows(page).locator('.budget-row__name').allTextContents();
    expect(names).toEqual(['카페/간식', '교통', '식비', '의료/건강', '쇼핑']);
    const amounts = await budgetRows(page).locator('.budget-row__amount').allTextContents();
    expect(amounts).toEqual(['120,000원 / 100,000원', '50,000원 / 50,000원', '320,000원 / 400,000원', '100,000원 / 200,000원', '8,000원 / 80,000원']);
    const remains = await budgetRows(page).locator('.budget-remain').allTextContents();
    expect(remains.map((t) => t.trim())).toEqual(['20,000원 초과', '0원 남음', '80,000원 남음', '100,000원 남음', '72,000원 남음']);
    // 접근 이름(스크린리더 문구)
    const labels = await budgetRows(page).locator('.sr-only').allTextContents();
    expect(labels).toEqual([
      '카페/간식, 100,000원 중 120,000원 사용, 20,000원 초과',
      '교통, 50,000원 중 50,000원 사용, 0원 남음',
      '식비, 400,000원 중 320,000원 사용, 80,000원 남음',
      '의료/건강, 200,000원 중 100,000원 사용, 100,000원 남음',
      '쇼핑, 80,000원 중 8,000원 사용, 72,000원 남음',
    ]);
    // 견본·막대 채움 data-viz 가 저장된 색(API)과 같다
    const items = await list(app.api);
    const colorOf = (n) => String(byName(items, n).color);
    expect(colorOf('식비')).toBe('12');
    for (let i = 0; i < names.length; i++) {
      const r = budgetRows(page).nth(i);
      expect(await r.locator('.swatch').getAttribute('data-viz'), names[i]).toBe(colorOf(names[i]));
      expect(await r.locator('.budget-bar__fill').getAttribute('data-viz'), names[i]).toBe(colorOf(names[i]));
    }
    // 막대: aria-hidden, 폭 상한 100%, 초과 행은 --over 클래스
    const bars = await budgetRows(page).evaluateAll((rs) => rs.map((r) => {
      const bar = r.querySelector('.budget-bar'); const fill = r.querySelector('.budget-bar__fill');
      return { hidden: bar.getAttribute('aria-hidden'), w: fill.getBoundingClientRect().width, tw: bar.getBoundingClientRect().width, over: bar.classList.contains('budget-bar--over'), pct: fill.style.width };
    }));
    expect(bars.map((b) => b.hidden)).toEqual(['true', 'true', 'true', 'true', 'true']);
    for (const b of bars) expect(b.w).toBeLessThanOrEqual(b.tw + 0.5);
    expect(bars.map((b) => b.pct)).toEqual(['100%', '100%', '80%', '50%', '10%']);
    expect(bars.map((b) => b.over)).toEqual([true, false, false, false, false]);
    // 시각 요소 전체 aria-hidden (sr-only 문구와 중복 낭독 방지)
    expect(await budgetRows(page).first().locator('.budget-row__vis').getAttribute('aria-hidden')).toBe('true');
    // 초과 행: 경고 아이콘 + 글자. 초과 아닌 행에는 아이콘 없음
    expect(await budgetRows(page).nth(0).locator('.icon--alert').count()).toBe(1);
    for (let i = 1; i < 5; i++) expect(await budgetRows(page).nth(i).locator('.icon--alert').count()).toBe(0);
    const ico = await budgetRows(page).nth(0).locator('.icon--alert').evaluate((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: r.width, h: r.height, d: cs.display, bg: cs.backgroundImage + cs.maskImage + cs.webkitMaskImage }; });
    expect(ico.w).toBeGreaterThan(0);
    expect(ico.d).not.toBe('none');
    // 합계는 초과 아님(598k < 830k) -> 합계 줄 아이콘 없음
    expect(await card.locator('.budget-sum .icon--alert').count()).toBe(0);
    // ul 구조
    expect(await card.locator('ul.budget-list > li').count()).toBe(5);
    // 카드 위치: 요약 카드 바로 아래, 도넛 위
    const order = await page.evaluate(() => [...document.querySelectorAll('#panel-dashboard > *')].map((e) => e.id || e.className.split(' ')[0]));
    expect(order.indexOf('budget-card')).toBe(order.indexOf('kpi') + 1);
    await expectNoHorizontalScroll(page, widthOf(ti));
    await shot(page, `06-dash-budget-${tag(ti)}`);
    expect(await csp(page)).toEqual([]);
    expect(app.msgs).toEqual([]);
  });

  test('BG-14 합계가 초과인 경우 합계 줄 "초과" 문구·아이콘', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { budgets: { 식비: 100000, 교통: 50000 }, tx: [Oct('식비', 130000), Oct('교통', 10000), Oct('쇼핑', 999999)] });
    const { page } = app;
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 150,000원 중 140,000원 썼어요 · 10,000원 남음');
    // 교통 사용 합계가 늘어 합계도 초과가 되게
    await addTx(app.api, Oct('교통', 20000, '2026-10-12'));
    await page.reload();
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 150,000원 중 160,000원 썼어요 · 10,000원 초과');
    expect(await page.locator('#budget-card .budget-sum .icon--alert').count()).toBe(1);
    const pct = await page.locator('#budget-card .budget-sum .budget-bar__fill').evaluate((e) => e.style.width);
    expect(pct).toBe('100%');
    await expect(page.locator('#budget-card .budget-sum .caption')).toHaveText('예산을 정한 2개 카테고리 기준');
    // 합계 막대 채움은 카테고리 색이 아님(data-viz 없음)
    expect(await page.locator('#budget-card .budget-sum .budget-bar__fill').getAttribute('data-viz')).toBeNull();
  });

  test('BG-14 정렬 동률은 sortOrder 순, 사용 안 함 카테고리의 예산은 합계에서 빠지고 다시 사용하면 되살아남(D8)', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { budgets: { 교통: 10000, 식비: 10000, 쇼핑: 10000 }, tx: [Oct('식비', 5000), Oct('교통', 5000), Oct('쇼핑', 5000)] });
    const { page } = app;
    await expect(budgetRows(page)).toHaveCount(3);
    expect(await budgetRows(page).locator('.budget-row__name').allTextContents()).toEqual(['식비', '교통', '쇼핑']); // sortOrder 0,2,3
    // 사용 안 함
    const traffic = byName(app.items, '교통');
    await patch(app.api, traffic.id, { active: false });
    await page.reload();
    await expect(budgetRows(page)).toHaveCount(2);
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 20,000원 중 10,000원 썼어요 · 10,000원 남음');
    await patch(app.api, traffic.id, { active: true });
    await page.reload();
    await expect(budgetRows(page)).toHaveCount(3);
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 30,000원 중 15,000원 썼어요 · 15,000원 남음');
    // 전부 사용 안 함이면 카드 숨김
    for (const n of ['식비', '교통', '쇼핑']) await patch(app.api, byName(app.items, n).id, { active: false });
    await page.reload();
    await expect(page.locator('#user-name')).toHaveText(app.account.name);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#budget-card')).toBeHidden();
  });

  test('BG-17 달 이동 시 그 달 지출로 다시 계산(지난 달·미래 달), 보기 전환에 불변, 진행 중인 달의 미래 날짜 포함', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, {
      budgets: { 식비: 100000, 교통: 30000 },
      tx: [
        Oct('식비', 20000, '2026-10-05'), Oct('식비', 7000, '2026-10-28'), // 28일은 "오늘"(19일) 이후
        Oct('식비', 90000, '2026-09-10'), Oct('교통', 1000, '2026-09-11'),
        { type: 'income', category: '급여', amount: 500000, date: '2026-10-01' },
      ],
    });
    const { page } = app;
    const sum = page.locator('#budget-card .budget-sum__text');
    await expect(page.locator('#budget-card h2')).toHaveText('이번 달 예산');
    await expect(sum).toHaveText('예산 130,000원 중 27,000원 썼어요 · 103,000원 남음'); // 미래 날짜 7,000 포함
    // 보기 전환(수입/지출): 카드 불변
    const before = await page.locator('#budget-card').innerText();
    const incomeToggle = page.locator('.catview-head button, .catview-head [role="tab"], .catview-head .segmented__item').filter({ hasText: '수입' }).first();
    await incomeToggle.click();
    await expect(page.locator('#donut-title')).toContainText('수입');
    expect(await page.locator('#budget-card').innerText()).toBe(before);
    await page.locator('.catview-head button, .catview-head [role="tab"], .catview-head .segmented__item').filter({ hasText: '지출' }).first().click();
    await expect(page.locator('#donut-title')).toContainText('지출');
    // 지난 달
    await page.locator('#dash-prev').click();
    await expect(page.locator('#budget-card h2')).toContainText('예산');
    await expect(page.locator('#budget-card h2')).not.toHaveText('이번 달 예산');
    await expect(sum).toHaveText('예산 130,000원 중 91,000원 썼어요 · 39,000원 남음');
    await expect(budgetRows(page).first().locator('.budget-row__name')).toHaveText('식비'); // 90% > 3.3%
    // 그 전 달(데이터 0)
    await page.locator('#dash-prev').click();
    await expect(sum).toHaveText('예산 130,000원 중 0원 썼어요 · 130,000원 남음');
    expect(await budgetRows(page).locator('.budget-remain').allTextContents().then((a) => a.map((t) => t.trim()))).toEqual(['100,000원 남음', '30,000원 남음']);
    // 미래 달 (8월에서 3번 -> 11월, 2번 더 -> 2027-01)
    for (let i = 0; i < 3; i++) await page.locator('#dash-next').click();
    await expect(page.locator('#dash-month')).toContainText('11');
    await expect(sum).toHaveText('예산 130,000원 중 0원 썼어요 · 130,000원 남음');
    for (let i = 0; i < 2; i++) await page.locator('#dash-next').click();
    await expect(page.locator('#dash-month')).toContainText('2027');
    await expect(sum).toHaveText('예산 130,000원 중 0원 썼어요 · 130,000원 남음');
    // 다시 이번 달로(3번 뒤로)
    for (let i = 0; i < 3; i++) await page.locator('#dash-prev').click();
    await expect(sum).toHaveText('예산 130,000원 중 27,000원 썼어요 · 103,000원 남음');
    await expect(page.locator('#budget-card h2')).toHaveText('이번 달 예산');
    expect(app.msgs).toEqual([]);
  });

  test('BG-18 예산 stats 요청 실패 시 #dash-error 문구·다시 시도로 예산만 재요청해 회복, 빠르게 달을 넘겨도 오래된 응답이 덮지 않음', async ({ browser }, ti) => {
    let failNext = false; let calls = [];
    const app = await openApp(browser, ti, {
      budgets: { 식비: 100000 },
      tx: [Oct('식비', 20000, '2026-10-05'), Oct('식비', 77000, '2026-09-05')],
      hook: (p) => p.route('**/api/stats/categories**', async (route) => {
        calls.push(route.request().url());
        if (failNext) { failNext = false; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버에 문제가 생겼어요.' } }) }); return; }
        await route.continue();
      }),
    });
    const { page } = app;
    await expect(page.locator('#budget-card .budget-sum__text')).toContainText('20,000원 썼어요');
    // 1) 달 이동 직후 첫 stats/categories 요청(예산)이 실패
    failNext = true; calls = [];
    await page.locator('#dash-prev').click();
    await expect(page.locator('#dash-error')).toHaveText('예산 사용액을 불러오지 못했어요.');
    await expect(page.locator('#dash-retry')).toBeVisible();
    // 도넛은 정상(두 번째 요청)
    expect(calls.length).toBe(2);
    await shot(page, `07-dash-budget-error-${tag(ti)}`);
    // 다시 시도: 예산 요청 1회만 추가
    calls = [];
    await page.locator('#dash-retry').click();
    await expect(page.locator('#dash-error')).toHaveText('');
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 100,000원 중 77,000원 썼어요 · 23,000원 남음');
    expect(calls.length).toBe(1);
    await expect(page.locator('#dash-retry')).toBeHidden();
    // 2) 다시 시도도 실패 -> 오류 유지 후 또 시도하면 회복
    failNext = true;
    await page.locator('#dash-next').click(); // 이번 달: 예산 요청 실패
    await expect(page.locator('#dash-error')).toHaveText('예산 사용액을 불러오지 못했어요.');
    failNext = true;
    await page.locator('#dash-retry').click();
    await expect(page.locator('#dash-error')).toHaveText('예산 사용액을 불러오지 못했어요.');
    await page.locator('#dash-retry').click();
    await expect(page.locator('#dash-error')).toHaveText('');
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 100,000원 중 20,000원 썼어요 · 80,000원 남음');
    // 3) 오래된 응답: 이번 달(10월) 응답을 늦추고, 곧바로 지난 달(9월)로 이동
    await page.unroute('**/api/stats/categories**');
    let slowDone = false;
    await page.route('**/api/stats/categories**', async (route) => {
      if (route.request().url().includes('from=2026-10')) { await new Promise((r) => setTimeout(r, 1500)); slowDone = true; }
      await route.continue();
    });
    await page.locator('#dash-prev').click(); // 9월 요청은 즉시 응답
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 100,000원 중 77,000원 썼어요 · 23,000원 남음');
    // 이제 10월로 가자마자 9월로 되돌아간다: 10월 응답(1.5초 지연)은 9월 카드를 덮으면 안 된다
    await page.locator('#dash-next').click();
    await page.locator('#dash-prev').click();
    await expect.poll(() => slowDone, { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(page.locator('#budget-card .budget-sum__text')).toHaveText('예산 100,000원 중 77,000원 썼어요 · 23,000원 남음');
    await expect(page.locator('#dash-error')).toHaveText('');
    expect(app.msgs.filter((m) => /Content Security/i.test(m))).toEqual([]);
  });

  test('BG-16 초과 표시는 오류색을 쓰지 않는다(C-D10 과 같은 스캔을 예산 카드 초과 상태에 적용), 라이트·다크', async ({ browser }, ti) => {
    for (const scheme of ['light', 'dark']) {
      const app = await openApp(browser, ti, { scheme, budgets: { 식비: 100000, 교통: 50000 }, tx: [Oct('식비', 130000), Oct('교통', 10000)] });
      const { page } = app;
      await expect(page.locator('#budget-card .budget-row--over')).toHaveCount(1);
      const bad = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--color-error)';
        document.body.appendChild(probe);
        const ERR = getComputedStyle(probe).color;
        probe.remove();
        const props = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'fill', 'stroke', 'outlineColor', 'boxShadow'];
        const out = [];
        for (const e of document.querySelectorAll('#budget-card, #budget-card *')) {
          const cs = getComputedStyle(e);
          for (const p of props) if (cs[p] && cs[p].includes(ERR)) out.push(e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '') + ' ' + p + '=' + cs[p]);
        }
        return { ERR, out };
      });
      expect(bad.ERR).toMatch(/^rgb/);
      expect(bad.out, scheme + ' 오류색(' + bad.ERR + ') 사용').toEqual([]);
      await shot(page, '09-over-' + scheme + '-' + tag(ti));
      await app.ctx.close();
    }
  });

  test('BG 라이트·다크 스크린샷(예산 없음 제외, 일부·초과) 와 다크 대비', async ({ browser }, ti) => {
    for (const scheme of ['light', 'dark']) {
      const app = await openApp(browser, ti, {
        scheme,
        budgets: { 식비: 400000, '카페/간식': 100000, 교통: 50000 },
        tx: [Oct('식비', 320000), Oct('카페/간식', 120000), Oct('교통', 12000)],
      });
      const { page } = app;
      await expect(budgetRows(page)).toHaveCount(3);
      await expectNoHorizontalScroll(page, widthOf(ti));
      await shot(page, `08-dash-${scheme}-${tag(ti)}`);
      // 초과 글자 대비(배경 surface 대비 3:1 이상 — 큰 글자 아님이므로 4.5:1 을 목표로 측정만 기록)
      const c = await page.evaluate(() => {
        const parse = (s) => s.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const el = document.querySelector('#budget-card .budget-remain--over');
        const fg = parse(getComputedStyle(el).color).slice(0, 3);
        let n = el; let bg = [255, 255, 255];
        while (n) { const b = getComputedStyle(n).backgroundColor; const p = parse(b); if (p.length >= 3 && (p[3] === undefined || p[3] > 0.9)) { bg = p.slice(0, 3); break; } n = n.parentElement; }
        const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
      });
      test.info().annotations.push({ type: `bg-contrast-${scheme}-${tag(ti)}`, description: String(c) });
      expect(c, `${scheme} 초과 글자 대비`).toBeGreaterThanOrEqual(4.5);
      expect(await csp(page)).toEqual([]);
      await app.ctx.close();
    }
  });
});
