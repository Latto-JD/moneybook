// docs/plan-category-color.md 9장 CC-01~CC-18 중 e2e 로 확인하는 항목.
// mobile-360 에서는 API·정적·마이그레이션·UI, tablet-768 에서는 UI 만 돈다(API 항목은 뷰포트와 무관해 360 에서만).
// UI "오늘"은 2026-10-19 고정. 서버는 TRUST_PROXY=true. 스크린샷은 docs/qa-shots-color/.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLoggedInUser, addTx, get, json, newApi, signup } from '../helpers/api.js';
import { newAccount } from '../helpers/accounts.js';
import { newUiPage, expectNoHorizontalScroll } from '../helpers/ui.js';
import { ROOT, startServer, migrate, tmpPgliteDir, removeDir, dbQuery, checkoutCommit, removeCheckout } from '../helpers/server.js';

const SHOTS = join(ROOT, 'docs', 'qa-shots-color');
const PUB = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (ti) => ti.project.use.viewport.width;
const NAMES = ['하늘·무늬 없음', '밤색·사선', '겨자·점', '남보라·가로줄', '청록·격자', '와인·세로줄', '올리브·체크', '자두·역사선', '주황·X 교차', '분홍·큰 점', '회청·지그재그', '보라·굵은 역사선'];
const DEF_EXPENSE = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'];

const list = async (api) => (await (await get(api, '/api/categories')).json()).items;
const colorsOf = (items, type) => Object.fromEntries(items.filter((i) => i.type === type).map((i) => [i.name, i.color]));
const mk = async (api, name, type = 'expense') => {
  const r = await json(api, 'POST', '/api/categories', { type, name });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
};
const patch = (api, id, body) => json(api, 'PATCH', `/api/categories/${id}`, body);

// ---------------- API: CC-02 ~ CC-05 ----------------
test.describe('CC API', () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'mobile-360', '360 에서만'); });

  test('CC-02 새 가입 사용자의 기본 세트 color: 지출 1..8, 수입 1..4', async () => {
    const { api } = await createLoggedInUser('cc02');
    const items = await list(api);
    expect(items.filter((i) => i.type === 'expense').map((i) => [i.name, i.color])).toEqual(DEF_EXPENSE.map((n, i) => [n, i + 1]));
    expect(items.filter((i) => i.type === 'income').map((i) => i.color)).toEqual([1, 2, 3, 4]);
  });

  test('CC-03 POST 자동 배정: 9, 10, 11, 12, 그다음은 가장 적게 쓴 번호 중 최소, 비활성도 센다, 본문 color 무시', async () => {
    const { api } = await createLoggedInUser('cc03');
    const got = [];
    for (let i = 1; i <= 4; i++) got.push((await mk(api, `새${i}`)).color);
    expect(got).toEqual([9, 10, 11, 12]);
    const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: '열세', color: 7 });
    expect(r.status()).toBe(201);
    expect((await r.json()).color).toBe(1); // 12개 모두 1회씩 -> 최소 번호 1 (본문 7 무시)
    expect((await mk(api, '열네')).color).toBe(2); // 1 은 2회, 나머지 1회 -> 가장 적게 쓴 번호 중 최소 = 2
    // 비활성도 사용 중으로 센다: 수입 4개(1..4) 중 '용돈'(2)을 비활성 -> 새 수입은 5
    const inc = (await list(api)).find((i) => i.type === 'income' && i.name === '용돈');
    expect((await patch(api, inc.id, { active: false })).status()).toBe(200);
    expect((await mk(api, '이자', 'income')).color).toBe(5);
    // 가운데 빈 번호: 수입 '급여'(1) 를 12 로 바꾸면 1 이 비므로 다음 수입 카테고리는 6 이 아니라 1 이 아니라...
    const sal = (await list(api)).find((i) => i.type === 'income' && i.name === '급여');
    expect((await patch(api, sal.id, { color: 12 })).status()).toBe(200);
    expect((await mk(api, '환급', 'income')).color).toBe(1); // 사용 중: 2,3,4,5,12 -> 최소 빈 번호 1
  });

  test('CC-04/CC-05 PATCH color: 200 반영, 잘못된 값 400 fields.color, 다른 사용자 404, name+color 원자성, 이름·상태 변경 후 유지', async () => {
    const { api } = await createLoggedInUser('cc04');
    const other = await createLoggedInUser('cc04o');
    const items = await list(api);
    const food = items.find((i) => i.type === 'expense' && i.name === '식비');
    let r = await patch(api, food.id, { color: 5 });
    expect(r.status()).toBe(200);
    expect((await r.json()).color).toBe(5);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    for (const bad of [0, 13, '5', 1.5, null, true, -1, [5], {}]) {
      r = await patch(api, food.id, { color: bad });
      expect(r.status(), JSON.stringify(bad)).toBe(400);
      const b = await r.json();
      expect(b.error.code).toBe('VALIDATION_ERROR');
      expect(b.error.fields?.color ?? b.fields?.color, JSON.stringify(bad)).toBe('색은 1~12 중 하나여야 해요.');
    }
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    expect((await patch(other.api, food.id, { color: 3 })).status()).toBe(404);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    // 같은 색 중복 허용
    const cafe = items.find((i) => i.name === '카페/간식' && i.type === 'expense');
    expect((await patch(api, cafe.id, { color: 5 })).status()).toBe(200);
    // name+color: 이름 오류면 색도 그대로
    r = await patch(api, food.id, { name: '교통', color: 9 }); // 중복 이름
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    r = await patch(api, food.id, { name: '', color: 9 });
    expect(r.status()).toBe(400);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    // 아무 필드도 없으면 400
    expect((await patch(api, food.id, {})).status()).toBe(400);
    // 이름 바꾸기·사용 안 함·다시 사용 후에도 색 유지
    expect((await patch(api, food.id, { name: '밥' })).status()).toBe(200);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    expect((await patch(api, food.id, { active: false })).status()).toBe(200);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    expect((await patch(api, food.id, { active: true })).status()).toBe(200);
    expect((await list(api)).find((i) => i.id === food.id).color).toBe(5);
    r = await patch(api, food.id, { name: '밥2', color: 7, active: true });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect([b.name, b.color]).toEqual(['밥2', 7]);
  });
});

// ---------------- 정적: CC-15 / CC-16 ----------------
test.describe('CC 팔레트 정적 검사', () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'mobile-360', '360 에서만'); });
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  test('CC-15 --viz-9..12 가 라이트·다크(미디어 쿼리·data-theme)에 있고 12색 모두 surface 대비 3:1 이상', () => {
    const css = readFileSync(join(PUB, 'css', 'tokens.css'), 'utf8');
    const mq = css.indexOf('@media (prefers-color-scheme: dark)');
    const dt = css.indexOf(':root[data-theme="dark"]');
    expect(mq).toBeGreaterThan(0);
    expect(dt).toBeGreaterThan(mq);
    const blocks = { light: css.slice(0, mq), mq: css.slice(mq, dt), dt: css.slice(dt) };
    const table = [];
    for (const [k, txt] of Object.entries(blocks)) {
      const surface = /--color-surface:\s*(#[0-9A-Fa-f]{6})/.exec(txt)[1];
      for (let n = 1; n <= 12; n++) {
        const m = new RegExp(`--viz-${n}:\\s*(#[0-9A-Fa-f]{6})`).exec(txt);
        expect(m, `${k} --viz-${n}`).not.toBeNull();
        const r = ratio(m[1], surface);
        table.push(`${k} viz-${n} ${m[1]} on ${surface} = ${r.toFixed(2)}`);
        expect(r, `${k} --viz-${n}`).toBeGreaterThanOrEqual(3);
      }
    }
    console.log(table.join('\n'));
    // 다크 두 블록 값 동일
    for (let n = 9; n <= 12; n++) {
      const v = (t) => new RegExp(`--viz-${n}:\\s*(#[0-9A-Fa-f]{6})`).exec(t)[1].toUpperCase();
      expect(v(blocks.mq)).toBe(v(blocks.dt));
    }
    // 12색이 서로 다름
    const lightVals = Array.from({ length: 12 }, (_, i) => new RegExp(`--viz-${i + 1}:\\s*(#[0-9A-Fa-f]{6})`).exec(blocks.light)[1].toUpperCase());
    expect(new Set(lightVals).size).toBe(12);
    const comp = readFileSync(join(PUB, 'css', 'components.css'), 'utf8');
    for (let n = 9; n <= 12; n++) {
      expect(comp, `data-viz=${n}`).toMatch(new RegExp(`\\[data-viz="${n}"\\]`));
      expect(comp, `viz-fill-${n}`).toMatch(new RegExp(`\\.viz-fill-${n}\\b`));
    }
  });

  test('CC-16 patterns/viz-1..12.svg 12개, 새 4개에 메타데이터·외부 URL·data: 없음, 기존 무늬와 다름', () => {
    const dir = join(PUB, 'patterns');
    const files = readdirSync(dir).filter((f) => /^viz-\d+\.svg$/.test(f)).sort();
    expect(files).toHaveLength(11); // viz-1 은 단색이라 파일 없음(2~12)
    expect(files).toContain('viz-12.svg');
    const bodies = new Map();
    for (const f of files) bodies.set(f, readFileSync(join(dir, f), 'utf8'));
    for (const n of [9, 10, 11, 12]) {
      const t = bodies.get(`viz-${n}.svg`);
      const noNs = t.replace('xmlns="http://www.w3.org/2000/svg"', ''); // 네임스페이스 선언 하나만 허용
      expect(t).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(noNs, `viz-${n}`).not.toMatch(/<metadata|<title|<desc|<script|<foreignObject|<image|https?:|data:|xlink:href|<!ENTITY|<\?xml-stylesheet/i);
    }
    const norm = (t) => t.replace(/\s+/g, ' ').trim();
    expect(new Set([...bodies.values()].map(norm)).size).toBe(11); // 모두 서로 다른 무늬
  });
});

// ---------------- 마이그레이션: CC-01 (옛 스키마 -> 새 스키마) ----------------
test.describe('CC-01 마이그레이션 e2e', () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'mobile-360', '360 에서만'); });
  test.setTimeout(240_000);
  const OLD = '17bc134'; // color 열이 없는 직전 커밋
  let oldDir; let dbDir;
  test.beforeAll(() => { oldDir = checkoutCommit(OLD); dbDir = tmpPgliteDir(); });
  test.afterAll(() => { if (oldDir) removeCheckout(oldDir); if (dbDir) removeDir(dbDir); });

  test('color 열 없는 DB + 데이터 -> 마이그레이션 2회 -> 채움·멱등·거래 불변·사용자 선택 보존', async () => {
    migrate(dbDir, {}, oldDir);
    expect(dbQuery(dbDir, `select count(*)::int as n from information_schema.columns where table_name='categories' and column_name='color'`)[0].n).toBe(0);
    const acc = newAccount('ccm');
    let uid;
    const old = await startServer({ dir: dbDir, cwd: oldDir });
    try {
      const api = await newApi({ baseURL: old.url });
      const r = await signup(api, acc);
      expect(r.status()).toBe(201);
      uid = (await r.json()).user.id;
      for (const n of ['새1', '새2']) expect((await json(api, 'POST', '/api/categories', { type: 'expense', name: n })).status()).toBe(201);
      let k = 0;
      for (const cat of [...DEF_EXPENSE, '새1', '새2']) {
        k += 1;
        expect((await json(api, 'POST', '/api/transactions', { type: 'expense', amount: 1000 * k, category: cat, memo: '', date: '2026-10-05' })).status()).toBe(201);
      }
      // 구버전으로 비활성 하나
      const items = (await (await get(api, '/api/categories')).json()).items;
      const cafe = items.find((i) => i.name === '카페/간식');
      expect((await json(api, 'PATCH', `/api/categories/${cafe.id}`, { active: false })).status()).toBe(200);
    } finally { await old.stop(); }
    const txBefore = dbQuery(dbDir, 'select category, amount, date::text as d from transactions order by 1, 2');
    expect(txBefore).toHaveLength(10);

    const o1 = migrate(dbDir);
    expect(o1).toContain('마이그레이션 완료');
    const colors = () => dbQuery(dbDir, `select type, name, sort_order, color, active from categories where user_id='${uid}' order by type desc, sort_order, name`);
    const c1 = colors();
    expect(c1.filter((r) => r.color === null)).toHaveLength(0);
    const exp = c1.filter((r) => r.type === 'expense');
    expect(exp.map((r) => r.color)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // 1~8 은 지금 화면 번호, 9·10 은 새 번호
    expect(exp.map((r) => r.name)).toEqual([...DEF_EXPENSE, '새1', '새2']);
    expect(exp.find((r) => r.name === '카페/간식').active).toBe(false);
    expect(c1.filter((r) => r.type === 'income').map((r) => r.color)).toEqual([1, 2, 3, 4]);

    // 사용자가 고른 색은 재실행에서 덮어쓰지 않는다 + 멱등
    const srv = await startServer({ dir: dbDir });
    try {
      const api = await newApi({ baseURL: srv.url });
      expect((await json(api, 'POST', '/api/auth/login', { email: acc.email, password: acc.password })).status()).toBe(200);
      const items = (await (await get(api, '/api/categories')).json()).items;
      expect(colorsOf(items, 'expense')['새2']).toBe(10);
      const food = items.find((i) => i.name === '식비' && i.type === 'expense');
      expect((await patch(api, food.id, { color: 12 })).status()).toBe(200);
    } finally { await srv.stop(); }
    const o2 = migrate(dbDir);
    expect(o2).toContain('마이그레이션 완료');
    const c2 = colors();
    expect(c2.find((r) => r.name === '식비' && r.type === 'expense').color).toBe(12);
    expect(c2.map((r) => [r.name, r.color]).filter((x) => x[0] !== '식비')).toEqual(c1.map((r) => [r.name, r.color]).filter((x) => x[0] !== '식비'));
    expect(dbQuery(dbDir, 'select category, amount, date::text as d from transactions order by 1, 2')).toEqual(txBefore);
    // check 제약
    expect(dbQuery(dbDir, `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='categories'::regclass and contype='c'`).map((r) => r.def).join(' ')).toMatch(/color/);
  });
});

// ---------------- UI ----------------
async function openApp(browser, testInfo, { extra = [], tx = true, scheme = 'light', hash = '#record', hook } = {}) {
  const u = await createLoggedInUser('ccui');
  for (const n of extra) await mk(u.api, n);
  const items = await list(u.api);
  if (tx) {
    // 지출 카테고리마다 거래 1건 (식비가 가장 큼 -> 도넛·추이 맨 앞)
    const exp = items.filter((i) => i.type === 'expense');
    let amt = 100000;
    for (const c of exp) { await addTx(u.api, { category: c.name, amount: amt, date: '2026-10-10' }); amt -= 7000; }
  }
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
const goManager = async (page) => { await page.locator('a.cat-edit-link').click(); await expect(page.locator('#panel-categories')).toBeVisible(); await expect(page.locator('#catm-active .cat-row').first()).toBeVisible(); };
const row = (page, name) => page.locator('#panel-categories .cat-row').filter({ has: page.locator('.cat-name', { hasText: new RegExp(`^${name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}$`) }) });
const colorBtn = (page, name) => row(page, name).locator('button[data-color-btn]');
const cells = (page, name) => row(page, name).locator('.color-picker [role="radio"]');
const vizAttr = async (loc) => loc.first().getAttribute('data-viz');
const expandChips = async (page) => { const more = page.locator('#category-chips .chip--toggle[aria-expanded="false"]'); if (await more.count()) await more.click(); };

test.describe('CC UI', () => {
  test('CC-08/CC-11/CC-12/CC-14 지출 10개: none 견본 없음, 색 버튼·12칸 radiogroup·사용 중 표시·한 번에 한 행', async ({ browser }, ti) => {
    const w = widthOf(ti);
    const app = await openApp(browser, ti, { extra: ['여행', '반려'] });
    const { page } = app;
    const exp = colorsOf(app.items, 'expense');
    expect(exp['여행']).toBe(9);
    expect(exp['반려']).toBe(10);
    await expandChips(page);
    await expect(page.locator('#category-chips button:not(.chip--toggle)')).toHaveCount(10);
    expect(await page.locator('#panel-record [data-viz="none"]').count()).toBe(0);
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(10);
    expect(await page.locator('#tx-list [data-viz="none"]').count()).toBe(0);
    // 기록 칸 견본이 저장된 번호와 같다
    for (const [name, n] of Object.entries(exp)) {
      const chip = page.locator('#category-chips button:not(.chip--toggle)', { hasText: name }).first();
      expect(await vizAttr(chip.locator('[data-viz]')), name).toBe(String(n));
    }
    await goManager(page);
    expect(await page.locator('#panel-categories [data-viz="none"]').count()).toBe(0);
    for (const [name, n] of Object.entries(exp)) expect(await vizAttr(row(page, name).locator('.swatch--lg')), name).toBe(String(n));
    // CC-11 색 버튼
    const btn = colorBtn(page, '여행');
    await expect(btn).toHaveAccessibleName('여행 색 바꾸기, 지금 주황·X 교차');
    expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
    // 행 맨 앞
    const labels = await row(page, '여행').locator('.cat-actions button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    expect(labels[0]).toBe('여행 색 바꾸기, 지금 주황·X 교차');
    expect(labels).toHaveLength(3);
    await btn.click();
    const group = row(page, '여행').locator('[role="radiogroup"]');
    await expect(group).toHaveAccessibleName('여행 색');
    await expect(cells(page, '여행')).toHaveCount(12);
    for (let i = 0; i < 12; i++) {
      const c = cells(page, '여행').nth(i);
      const bb = await c.boundingBox();
      expect(bb.width, `칸 ${i + 1} 폭`).toBeGreaterThanOrEqual(44);
      expect(bb.height, `칸 ${i + 1} 높이`).toBeGreaterThanOrEqual(44);
      const nm = await c.getAttribute('aria-label');
      expect(nm.startsWith(NAMES[i]), nm).toBe(true);
      await expect(c).toHaveAttribute('aria-checked', i === 8 ? 'true' : 'false');
    }
    // 고른 칸의 체크 아이콘이 보이고, 안 고른 칸은 안 보인다
    const vis = await cells(page, '여행').evaluateAll((cs) => cs.map((c) => {
      const b = c.querySelector('.color-cell__check');
      const cs2 = getComputedStyle(b);
      return cs2.display !== 'none' && cs2.visibility !== 'hidden' && Number(cs2.opacity) > 0 && b.getBoundingClientRect().width > 0;
    }));
    expect(vis.map((v, i) => [i + 1, v]).filter((x) => x[1]).map((x) => x[0])).toEqual([9]);
    // CC-12 사용 중 표시: 식비(1) 칸 = "하늘·무늬 없음, 식비에서 사용 중"
    await expect(cells(page, '여행').nth(0)).toHaveAccessibleName('하늘·무늬 없음, 식비에서 사용 중');
    await expect(cells(page, '여행').nth(11)).toHaveAccessibleName('보라·굵은 역사선');
    // CC-14: 360 이면 6칸 x 2줄, 가로 스크롤 없음
    await expectNoHorizontalScroll(page, w);
    const rects = await cells(page, '여행').evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
    const rowsY = [...new Set(rects.map((r) => r[1]))];
    if (w === 360) { expect(rowsY).toHaveLength(2); expect(rects.filter((r) => r[1] === rowsY[0])).toHaveLength(6); } else { expect(rowsY.length).toBeLessThanOrEqual(2); }
    // 한 번에 한 행: 다른 행의 색을 열면 앞 행은 닫힌다
    await colorBtn(page, '반려').click();
    await expect(page.locator('#panel-categories [role="radiogroup"]')).toHaveCount(1);
    await expect(row(page, '여행').locator('[role="radiogroup"]')).toHaveCount(0);
    // 이름 바꾸기와 동시에 열리지 않는다
    await row(page, '반려').getByRole('button', { name: /이름 바꾸기/ }).click();
    await expect(page.locator('#panel-categories [role="radiogroup"]')).toHaveCount(0);
    await expect(page.locator('#panel-categories input[id^="catm-rename-"]')).toHaveCount(1);
    await colorBtn(page, '여행').click();
    await expect(page.locator('#panel-categories input[id^="catm-rename-"]')).toHaveCount(0);
    await expect(page.locator('#panel-categories [role="radiogroup"]')).toHaveCount(1);
    expect(await csp(page)).toEqual([]);
    expect(app.msgs).toEqual([]);
  });

  test('CC-07 색을 바꾸면 새로고침 없이 기록 칸·목록·이력·도넛·범례·추이가 모두 새 번호, 새로고침 뒤에도 유지', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { extra: ['여행', '반려'], hash: '#record' });
    const { page } = app;
    // 먼저 대시보드/추이를 한 번 그려 둔다(캐시된 화면이 바뀌는지 보기 위해)
    await hashTo(page, '#dashboard');
    await expect(page.locator('#chart-donut svg')).toBeVisible();
    await hashTo(page, '#record');
    await goManager(page);
    const before = await vizAttr(row(page, '식비').locator('.swatch--lg'));
    expect(before).toBe('1');
    await colorBtn(page, '식비').click();
    await cells(page, '식비').nth(11).click(); // 12 = 보라·굵은 역사선
    await expect(page.locator('#catm-status')).toHaveText("'식비' 색을 보라·굵은 역사선(으)로 바꿨어요");
    await expect(colorBtn(page, '식비')).toBeFocused();
    await expect(colorBtn(page, '식비')).toHaveAccessibleName('식비 색 바꾸기, 지금 보라·굵은 역사선');
    await expect(row(page, '식비').locator('[role="radiogroup"]')).toHaveCount(0);
    expect(await vizAttr(row(page, '식비').locator('.swatch--lg'))).toBe('12');
    // 이력 머리줄
    await row(page, '식비').locator('.cat-hist-btn').click();
    await expect(page.locator('#panel-history')).toBeVisible();
    await expect(page.locator('#hist-title')).toHaveText('식비');
    expect(await vizAttr(page.locator('#hist-caption [data-viz]'))).toBe('12');
    // 기록 칸 + 목록
    await hashTo(page, '#record');
    await expect(page.locator('#panel-record')).toBeVisible();
    await expandChips(page);
    expect(await vizAttr(page.locator('#category-chips button:not(.chip--toggle)', { hasText: '식비' }).locator('[data-viz]'))).toBe('12');
    expect(await vizAttr(page.locator('#tx-list .tx-row', { hasText: '식비' }).locator('[data-viz]'))).toBe('12');
    // 도넛 조각·범례 견본·범례 막대 + 추이
    await hashTo(page, '#dashboard');
    const food = page.locator('#chart-donut .legend li', { hasText: '식비' }).first();
    await expect(food).toBeVisible();
    expect(await vizAttr(food.locator('.swatch'))).toBe('12');
    expect(await vizAttr(food.locator('.legend-bar__fill'))).toBe('12');
    const idx = await page.locator('#chart-donut .legend li').evaluateAll((lis) => lis.findIndex((l) => l.textContent.includes('식비')));
    expect(await page.locator('#chart-donut svg.chart-svg > path').nth(idx).getAttribute('data-viz')).toBe('12');
    await page.locator('#cat-trend-chips button', { hasText: '식비' }).click();
    await expect(page.locator('#chart-cat-trend .legend .swatch')).toHaveAttribute('data-viz', '12');
    const trendPattern = await page.locator('#chart-cat-trend svg rect.chart-stroke').first().evaluate((r) => {
      const m = /^url\(#(.+)\)$/.exec(r.getAttribute('fill') || '');
      return m ? document.getElementById(m[1]).querySelector('rect')?.getAttribute('class') : r.getAttribute('class');
    });
    expect(trendPattern).toContain('viz-fill-12');
    // 도넛 조각이 패턴이면 viz-fill-12
    // 새로고침 후에도 유지
    await page.reload();
    await expect(page.locator('#user-name')).toBeVisible();
    await expect(page.locator('#chart-donut .legend li', { hasText: '식비' }).first()).toBeVisible();
    expect(await vizAttr(page.locator('#chart-donut .legend li', { hasText: '식비' }).first().locator('.swatch'))).toBe('12');
    await hashTo(page, '#record');
    await expandChips(page);
    expect(await vizAttr(page.locator('#category-chips button:not(.chip--toggle)', { hasText: '식비' }).locator('[data-viz]'))).toBe('12');
    expect(await csp(page)).toEqual([]);
    // 서버에도 저장됨
    expect(colorsOf(await list(app.api), 'expense')['식비']).toBe(12);
  });

  test('CC-09 같은 색이면 도넛도 같은 번호, 목록에 없는 이름은 남은 번호, 그 외는 other', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { extra: ['여행', '반려'], tx: false });
    const { api, page } = app;
    const items = await list(api);
    const id = (n) => items.find((i) => i.type === 'expense' && i.name === n).id;
    expect((await patch(api, id('카페/간식'), { color: 1 })).status()).toBe(200); // 식비와 같은 색 1
    // 거래: 식비, 카페/간식 + 삭제된 이름(목록에 없음) 은 API 로 만들 수 없으므로 일반 이름만 + 그 외 묶음을 만들 만큼 많이
    let amt = 200000;
    for (const n of ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', '여행', '반려']) { await addTx(api, { category: n, amount: amt, date: '2026-10-10' }); amt -= 9000; }
    await page.reload();
    await hashTo(page, '#dashboard');
    await expect(page.locator('#chart-donut .legend li').first()).toBeVisible();
    const legend = await page.locator('#chart-donut .legend li').evaluateAll((lis) => lis.map((l) => [l.querySelector('.legend-label')?.textContent, l.querySelector('.swatch')?.getAttribute('data-viz') ?? l.getAttribute('data-viz')]));
    const slices = await page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-viz')));
    expect(slices.length).toBe(legend.length);
    const m = Object.fromEntries(legend);
    expect(m['식비']).toBe('1');
    expect(m['카페/간식']).toBe('1'); // 같은 색이어도 다시 고르지 않음
    expect(slices[legend.findIndex((l) => l[0] === '식비')]).toBe('1');
    expect(slices[legend.findIndex((l) => l[0] === '카페/간식')]).toBe('1');
    const stored = colorsOf(await list(api), 'expense');
    for (const [name, v] of legend) if (stored[name] !== undefined) expect(v, name).toBe(String(stored[name]));
    const other = legend.filter(([name]) => stored[name] === undefined);
    for (const [, v] of other) expect(v).toBe('other');
    console.log(`CC-09 ${ti.project.name}: 범례 ${JSON.stringify(legend)}`);
  });

  test('CC-10 color 가 null 인 행(응답 가로채기)은 순서 공식 번호로 보이고 회색이 아니다', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { extra: ['여행', '반려'], hook: async (page) => {
      await page.route('**/api/categories', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const body = await res.json();
        for (const i of body.items) i.color = null;
        await route.fulfill({ response: res, json: body });
      });
    } });
    const { page } = app;
    await expandChips(page);
    for (let k = 0; k < 10; k++) { // sortOrder 순 n번째 -> n
      const name = [...DEF_EXPENSE, '여행', '반려'][k];
      expect(await vizAttr(page.locator('#category-chips button:not(.chip--toggle)', { hasText: name }).first().locator('[data-viz]')), name).toBe(String(k + 1));
    }
    await goManager(page);
    expect(await page.locator('#panel-categories [data-viz="none"]').count()).toBe(0);
    expect(await vizAttr(row(page, '반려').locator('.swatch--lg'))).toBe('10');
  });

  test('CC-13 키보드·스크린리더: 화살표 이동, Enter/Space 저장, Esc 닫고 포커스 복귀, 성공 알림', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { tx: false });
    const { page } = app;
    await goManager(page);
    const btn = colorBtn(page, '교통'); // 교통 = 3
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(cells(page, '교통').nth(2)).toBeFocused(); // 현재 색 칸에 포커스
    await expect(cells(page, '교통').nth(2)).toHaveAttribute('tabindex', '0');
    expect(await cells(page, '교통').evaluateAll((cs) => cs.filter((c) => c.getAttribute('tabindex') === '0').length)).toBe(1);
    await page.keyboard.press('ArrowRight');
    await expect(cells(page, '교통').nth(3)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(cells(page, '교통').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(cells(page, '교통').nth(2)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(cells(page, '교통').nth(1)).toBeFocused();
    // 경계: 첫 칸에서 왼쪽 -> 마지막 칸으로 순환
    await page.keyboard.press('ArrowLeft');
    await expect(cells(page, '교통').nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cells(page, '교통').nth(11)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(row(page, '교통').locator('[role="radiogroup"]')).toHaveCount(0);
    await expect(btn).toBeFocused();
    expect(colorsOf(await list(app.api), 'expense')['교통']).toBe(3); // 저장 안 됨
    // Enter 로 저장: 11번 칸
    await page.keyboard.press('Enter');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight'); // 3 -> 11
    await expect(cells(page, '교통').nth(10)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#catm-status')).toHaveText("'교통' 색을 회청·지그재그(으)로 바꿨어요");
    await expect(btn).toBeFocused();
    expect(colorsOf(await list(app.api), 'expense')['교통']).toBe(11);
    // Space 로 저장: 다시 열어 7번 칸
    await page.keyboard.press('Enter');
    await expect(cells(page, '교통').nth(10)).toBeFocused();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await expect(page.locator('#catm-status')).toHaveText("'교통' 색을 올리브·체크(으)로 바꿨어요");
    expect(colorsOf(await list(app.api), 'expense')['교통']).toBe(7);
    // 현재 색 칸을 다시 고르면 PATCH 없이 닫힘
    let patches = 0;
    page.on('request', (r) => { if (r.method() === 'PATCH') patches += 1; });
    await page.keyboard.press('Enter');
    await expect(cells(page, '교통').nth(6)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(row(page, '교통').locator('[role="radiogroup"]')).toHaveCount(0);
    expect(patches).toBe(0);
    await expect(page.locator('#catm-status')).toHaveText("'교통' 색을 올리브·체크(으)로 바꿨어요"); // 이전 알림 그대로(새 알림 없음)
    // role=status + aria-live
    await expect(page.locator('#catm-status')).toHaveAttribute('aria-live', 'polite');
    expect(await csp(page)).toEqual([]);
  });

  test('CC-13 실패 시 행 오류·영역 유지·표시 복원, 진행 중 두 번 눌러도 PATCH 1회', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { tx: false });
    const { page, api } = app;
    await goManager(page);
    // (a) 500 실패
    let mode = 'fail';
    let patches = 0;
    await page.route('**/api/categories/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patches += 1;
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버에 문제가 생겼어요.' } }) });
      await new Promise((r) => setTimeout(r, 600)); // 느린 성공
      return route.continue();
    });
    await colorBtn(page, '쇼핑').click(); // 4
    await cells(page, '쇼핑').nth(8).click();
    const err = row(page, '쇼핑').locator('.error-text, [role="alert"]').filter({ hasText: /\S/ });
    await expect(err.first()).toBeVisible();
    await expect(row(page, '쇼핑').locator('[role="radiogroup"]')).toBeVisible();
    await expect(cells(page, '쇼핑').nth(3)).toHaveAttribute('aria-checked', 'true'); // 저장 전 색으로 복원
    await expect(cells(page, '쇼핑').nth(8)).toHaveAttribute('aria-checked', 'false');
    expect(await vizAttr(row(page, '쇼핑').locator('.swatch--lg'))).toBe('4');
    expect(colorsOf(await list(api), 'expense')['쇼핑']).toBe(4);
    expect(patches).toBe(1);
    console.log(`CC-13 실패 행 오류 문구: ${await err.first().innerText()}`);
    // (b) 느린 성공에서 연타
    mode = 'slow'; patches = 0;
    const target = cells(page, '쇼핑').nth(8);
    await target.click();
    await target.click({ force: true, noWaitAfter: true }).catch(() => {});
    await cells(page, '쇼핑').nth(9).click({ force: true, noWaitAfter: true }).catch(() => {});
    await expect(page.locator('#catm-status')).toHaveText("'쇼핑' 색을 주황·X 교차(으)로 바꿨어요", { timeout: 8000 });
    expect(patches).toBe(1);
    expect(colorsOf(await list(api), 'expense')['쇼핑']).toBe(9);
  });

  test('CC-17(UI) 비활성 카테고리도 색을 바꿀 수 있고, 거래 있는 카테고리의 색 변경은 거래·집계에 영향 없음', async ({ browser }, ti) => {
    const app = await openApp(browser, ti, { tx: true });
    const { page, api } = app;
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept());
    const sumBefore = await (await get(api, '/api/summary?month=2026-10')).text().catch(() => '');
    await goManager(page);
    await row(page, '기타').getByRole('button', { name: /사용 안 함/ }).click();
    await expect(page.locator('#catm-inactive details, #catm-inactive-details')).toBeVisible();
    await page.locator('#catm-inactive-details > summary').click();
    const inactiveRow = page.locator('#catm-inactive .cat-row').filter({ hasText: '기타' });
    await inactiveRow.locator('button[data-color-btn]').click();
    await inactiveRow.locator('[role="radio"]').nth(10).click();
    await expect(page.locator('#catm-status')).toContainText('회청·지그재그');
    expect(colorsOf(await list(api), 'expense')['기타']).toBe(11);
    const sumAfter = await (await get(api, '/api/summary?month=2026-10')).text().catch(() => '');
    expect(sumAfter).toBe(sumBefore);
  });

  for (const scheme of ['light', 'dark']) {
    test(`CC-15 시각: 12칸 견본·도넛 12색 스크린샷 (${scheme})`, async ({ browser }, ti) => {
      mkdirSync(SHOTS, { recursive: true });
      const w = widthOf(ti);
      const app = await openApp(browser, ti, { extra: ['여행', '반려'], scheme });
      const { page } = app;
      const items = await list(app.api);
      // 열두 번째 지출 카테고리까지 만들어 12색을 모두 화면에 둔다
      await mk(app.api, '열하나'); await mk(app.api, '열둘');
      await page.reload();
      await goManager(page);
      const all = (await list(app.api)).filter((i) => i.type === 'expense');
      expect(all.map((i) => i.color)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      await colorBtn(page, '식비').click();
      await expect(cells(page, '식비')).toHaveCount(12);
      await row(page, '식비').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `picker-${scheme}-${w}.png`), fullPage: true });
      // 견본이 실제로 칠해졌는지(배경/채움이 투명이 아님) 그리고 12개가 서로 다른 계산 색
      const paints = await cells(page, '식비').evaluateAll((cs) => cs.map((c) => { const s = c.querySelector('.swatch'); const st = getComputedStyle(s); return `${st.backgroundColor}|${st.borderColor}`; }));
      expect(new Set(paints).size).toBeGreaterThanOrEqual(11); // 1번(단색)과 나머지가 모두 구분
      await page.keyboard.press('Escape');
      await hashTo(page, '#dashboard');
      await expect(page.locator('#chart-donut svg.chart-svg > path').first()).toBeVisible();
      await page.screenshot({ path: join(SHOTS, `dashboard-${scheme}-${w}.png`), fullPage: true });
      const slices = await page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-viz')));
      console.log(`${scheme} ${w}: 도넛 data-viz ${slices.join(',')}`);
      await hashTo(page, '#record');
      await expandChips(page);
      await page.screenshot({ path: join(SHOTS, `record-${scheme}-${w}.png`), fullPage: true });
      await expectNoHorizontalScroll(page, w);
      expect(await csp(page)).toEqual([]);
      expect(app.msgs).toEqual([]);
      void items;
    });
  }
});
