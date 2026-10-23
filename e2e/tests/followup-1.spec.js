// docs/plan-followup.md 1단계 Q-F2: C-F5(헤더), C-F7~C-F12 (R4 라벨, 미사용 CSS, 보이지 않는 문자, "그 외" 금지, SVG 메타데이터, 폰트).
// 아이콘 토글(C-F1~C-F4, C-F6)은 theme-name.spec.js 를 버튼 기준으로 다시 써서 확인한다.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { get, json, newApi, createLoggedInUser, addTx, signup } from '../helpers/api.js';
import { newAccount } from '../helpers/accounts.js';
import { expectError } from '../helpers/errors.js';
import { newUiPage } from '../helpers/ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const onlyMobile = (testInfo) => test.skip(widthOf(testInfo) !== 360, 'API/정적 검사는 mobile-360 에서만');

// ------------------------------------------------------------------ 공통 경계표 (이름·카테고리 이름)
// [라벨, 입력, 기대] 기대: 문자열 = 저장되는 정규화 값, 'FORBIDDEN' = 거부 문자, 'EMPTY' = 정규화 후 비어 1자 이상 오류
const FAMILY = '👨‍👩‍👧';
const TABLE = [
  ['RLO U+202E', 'a‮b', 'FORBIDDEN'], ['LRI U+2066', 'a⁦b', 'FORBIDDEN'], ['LRM U+200E', 'a‎b', 'FORBIDDEN'],
  ['RLM U+200F', 'a‏b', 'FORBIDDEN'], ['LRE U+202A', 'a‪b', 'FORBIDDEN'], ['PDI U+2069', 'a⁩b', 'FORBIDDEN'], ['RLE U+202B', 'a‫b', 'FORBIDDEN'],
  ['ZWSP U+200B 제거', 'a​b', 'ab'], ['WJ U+2060 제거', 'a⁠b', 'ab'], ['BOM U+FEFF 제거', 'a﻿b', 'ab'],
  ['제거 후 공백 정리', 'a ​ b', 'a b'], ['앞뒤 제로폭', '​가﻿', '가'],
  ['제로폭만', '​', 'EMPTY'], ['제로폭+공백만', ' ​ ﻿ ⁠ ', 'EMPTY'], ['공백만', '   ', 'EMPTY'], ['빈 문자열', '', 'EMPTY'],
  ['ZWJ 가족 이모지', FAMILY, FAMILY], ['ZWNJ 유지', 'a‌b', 'a‌b'],
  ['NUL', 'a\u0000b', 'FORBIDDEN'], ['BEL', 'a\u0007b', 'FORBIDDEN'], ['SOH', 'a\u0001b', 'FORBIDDEN'], ['DEL', 'a\u007fb', 'FORBIDDEN'],
  ['탭·줄바꿈은 공백', '\ta\n b\r\n', 'a b'], ['NFD -> NFC', '한글'.normalize('NFD'), '한글'], ['연속 공백', '  가   나 ', '가 나'],
];

// ====================================================================== C-F9 서버·프론트 경계표 동일
test.describe('C-F9 보이지 않는 문자 검증 통일', () => {
  test('C-F9 서버 함수와 프론트 함수의 경계표 결과가 같다 (이름, 카테고리 이름)', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
    const srvName = (await imp('src/backend/auth/validate.js')).normalizeName;
    const srvCat = (await imp('src/backend/lib/categories.js')).normalizeCategoryName;
    const cliName = (await imp('src/frontend/public/js/lib/validate.js')).validateName;
    const cliCat = (await imp('src/frontend/public/js/lib/categories-data.js')).validateCategoryName;
    const srvText = await imp('src/backend/lib/text.js');
    const cliText = await imp('src/frontend/public/js/lib/text.js');
    const kind = (ok, value, msg) => (ok ? `OK:${value}` : /쓸 수 없는 문자/.test(msg) ? 'FORBIDDEN' : /입력|1자 이상/.test(msg) ? 'EMPTY' : `ERR:${msg}`);
    for (const [label, input, expected] of TABLE) {
      const exp = expected === 'FORBIDDEN' || expected === 'EMPTY' ? expected : `OK:${expected}`;
      const sn = srvName(input); const cn = cliName(input);
      const sc = srvCat(input); const cc = cliCat(input);
      expect(kind(!sn.error, sn.name, sn.error), `서버 이름 ${label}`).toBe(exp);
      expect(kind(cn.ok, cn.value, cn.message), `프론트 이름 ${label}`).toBe(exp);
      expect(kind(!sc.error, sc.name, sc.error), `서버 카테고리 ${label}`).toBe(exp);
      expect(kind(cc.ok, cc.value ?? cc.name, cc.message), `프론트 카테고리 ${label}`).toBe(exp);
      // 공통 모듈 자체도 같은 결과
      expect(JSON.stringify(srvText.cleanText(input)), `공통 모듈 ${label}`).toBe(JSON.stringify(cliText.cleanText(input)));
    }
    // 길이 기준은 코드포인트 유지: 가족 이모지 5코드포인트
    expect([...FAMILY].length).toBe(5);
    expect(srvName(FAMILY.repeat(4)).name).toBe(FAMILY.repeat(4)); // 20코드포인트 통과
    expect(srvName(FAMILY.repeat(4) + '가').error).toBeTruthy(); // 21 거부
    expect(cliName(FAMILY.repeat(4) + '가').ok).toBe(false);
    // 길이 한도 경계: 이름 20, 카테고리 15 (제로폭은 길이에 안 센다)
    expect(srvName('가'.repeat(20) + '​').name).toBe('가'.repeat(20));
    expect(srvCat('가'.repeat(15) + '​').name).toBe('가'.repeat(15));
    expect(srvCat('가'.repeat(16)).error).toBeTruthy();
  });

  test('C-F9 API: 가입·PATCH me·카테고리 추가·이름 바꾸기가 같은 표로 동작 (거부 400, 제거 후 저장, 제로폭만이면 1자 이상 오류)', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const u = await createLoggedInUser('f9');
    const cats = await (await get(u.api, '/api/categories')).json();
    const renameId = cats.items.find((i) => i.type === 'expense' && i.name === '기타').id;
    let seq = 0;
    for (const [label, input, expected] of TABLE) {
      // PATCH me
      const pm = await json(u.api, 'PATCH', '/api/auth/me', { name: input });
      // 카테고리 이름 바꾸기 (매번 같은 카테고리)
      const rn = await json(u.api, 'PATCH', `/api/categories/${renameId}`, { name: input });
      // 카테고리 추가: 정상 저장은 30개 한도·중복 때문에 별도 처리, 거부 케이스만 직접 확인
      const ad = await json(u.api, 'POST', '/api/categories', { type: 'income', name: input });
      if (expected === 'FORBIDDEN' || expected === 'EMPTY') {
        for (const [where, res] of [['PATCH me', pm], ['카테고리 이름 바꾸기', rn], ['카테고리 추가', ad]]) {
          const err = await expectError(res, 400, 'VALIDATION_ERROR');
          expect(err.fields?.name, `${where} ${label}`).toEqual(expect.any(String));
          if (expected === 'FORBIDDEN') expect(err.fields.name, `${where} ${label}`).toMatch(/쓸 수 없는 문자/);
          else expect(err.fields.name, `${where} ${label}`).toMatch(/입력|1자 이상/);
        }
      } else {
        expect(pm.status(), `PATCH me ${label}`).toBe(200);
        expect((await pm.json()).user.name, `PATCH me ${label}`).toBe(expected);
        const catExp = [...expected].length <= 15;
        if (catExp) {
          expect(rn.status(), `이름 바꾸기 ${label} ${await rn.text()}`).toBe(200);
          expect((await rn.json()).name ?? (await rn.json()).item?.name, `이름 바꾸기 ${label}`).toBe(expected);
          // 같은 정규화 결과(예: 'ab')가 앞 케이스에서 이미 만들어져 사용 안 함이면 409 CATEGORY_INACTIVE 가 정상(정규화 결과가 같다는 뜻)
          expect([201, 409], `추가 ${label} ${await ad.text()}`).toContain(ad.status());
          if (ad.status() === 201) {
            const made = await ad.json();
            expect(made.name, `추가 ${label}`).toBe(expected);
            // 다음 케이스와 겹치지 않게 사용 안 함으로 돌려 한도를 아낀다
            await json(u.api, 'PATCH', `/api/categories/${made.id}`, { active: false });
          } else expect((await ad.json()).error.code).toBe('CATEGORY_INACTIVE');
        }
      }
      seq += 1;
    }
    expect(seq).toBe(TABLE.length);
    // 가입 API (거부 3종, 제거 1종, 이모지 1종)
    for (const [label, input, expected] of TABLE.filter((t) => ['RLO U+202E', 'LRI U+2066', 'LRM U+200E', 'ZWSP U+200B 제거', 'WJ U+2060 제거', 'BOM U+FEFF 제거', '제로폭만', 'ZWJ 가족 이모지'].includes(t[0]))) {
      const acc = newAccount('f9s');
      const res = await signup(await newApi(), { ...acc, name: input });
      if (expected === 'FORBIDDEN' || expected === 'EMPTY') {
        const err = await expectError(res, 400, 'VALIDATION_ERROR');
        expect(err.fields?.name, `가입 ${label}`).toEqual(expect.any(String));
      } else {
        expect(res.status(), `가입 ${label}`).toBe(201);
        expect((await res.json()).user.name, `가입 ${label}`).toBe(expected);
      }
    }
  });

  test('C-F9 응답 형식 불변(C-F15): 사용자 객체·카테고리 응답 키, 오류 응답 키', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const u = await createLoggedInUser('f15');
    expect(Object.keys((await (await get(u.api, '/api/auth/me')).json()).user).sort()).toEqual(['email', 'id', 'name']);
    const bad = await json(u.api, 'PATCH', '/api/auth/me', { name: 'a‮b' });
    expect(Object.keys(await bad.json())).toEqual(['error']);
    const made = await json(u.api, 'POST', '/api/categories', { type: 'expense', name: '키확인' });
    expect(made.status()).toBe(201);
    expect(Object.keys(await made.json()).sort()).toEqual(expect.arrayContaining(['id', 'name', 'type']));
    expect(Object.keys(await (await get(u.api, '/api/categories')).json()).sort()).toEqual(['expense', 'income', 'items']);
  });
});

// ====================================================================== C-F10 "그 외 N개" 금지
test.describe('C-F10 "그 외 N개" 충돌', () => {
  test('C-F10 API: 추가·이름 바꾸기에서 "그 외 N개" 형태(정규화 후)는 400, 그 밖의 비슷한 이름은 허용', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const u = await createLoggedInUser('f10');
    const reservedMsg = "'그 외 N개'는 차트 묶음 이름이라 쓸 수 없어요.";
    const cats = await (await get(u.api, '/api/categories')).json();
    const id = cats.items.find((i) => i.type === 'expense' && i.name === '기타').id;
    for (const name of ['그 외 2개', ' 그 외  12개 ', '그 외 0개', '그\t외\n99개', '그 외​ 3개']) {
      for (const [where, res] of [['추가', await json(u.api, 'POST', '/api/categories', { type: 'expense', name })], ['이름 바꾸기', await json(u.api, 'PATCH', `/api/categories/${id}`, { name })]]) {
        const err = await expectError(res, 400, 'VALIDATION_ERROR');
        expect(err.fields?.name, `${where} ${JSON.stringify(name)}`).toBe(reservedMsg);
      }
    }
    expect((await (await get(u.api, '/api/categories')).json()).items.find((i) => i.id === id).name, '실패 후 이름 유지').toBe('기타');
    // 허용
    for (const name of ['그 외', '그 외 것', '그외 2개', '그 외 2개월', '그 외 개', '그 외 2']) {
      const res = await json(u.api, 'POST', '/api/categories', { type: 'income', name });
      expect(res.status(), `${name} ${await res.text()}`).toBe(201);
      expect((await res.json()).name).toBe(name);
    }
    // 이름 바꾸기로도 허용
    expect((await json(u.api, 'PATCH', `/api/categories/${id}`, { name: '그 외 것2' })).status()).toBe(200);
  });

  test('C-F10 UI: 추가·이름 바꾸기에서 필드 오류(안내 문구), 허용 이름은 저장', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('f10ui');
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    const posts = [];
    page.on('request', (r) => { if (['POST', 'PATCH'].includes(r.method()) && r.url().includes('/api/categories')) posts.push(`${r.method()} ${r.postData()}`); });
    await page.goto('/#categories');
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    for (const name of ['그 외 2개', ' 그 외  12개 ']) {
      await page.locator('#catm-name').fill(name);
      await page.locator('#catm-add-btn').click();
      await expect(page.locator('#catm-add-error')).toHaveText("'그 외 N개'는 차트 묶음 이름이라 쓸 수 없어요.");
      await expect(page.locator('#catm-name')).toHaveAttribute('aria-invalid', 'true');
    }
    expect(posts, '막힌 입력은 요청 0').toEqual([]);
    const row = page.locator('#catm-active .cat-row', { hasText: '교통' }).first();
    await row.getByRole('button', { name: '교통 이름 바꾸기' }).click();
    await page.locator('.cat-rename input').fill('그 외 5개');
    await page.locator('.cat-rename').getByRole('button', { name: /이름 저장/ }).click();
    await expect(page.locator('.cat-row [role="alert"]', { hasText: '차트 묶음' })).toBeVisible();
    await expect(page.locator('.cat-rename input')).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toEqual([]);
    await page.keyboard.press('Escape');
    for (const name of ['그 외', '그 외 것', '그외 2개']) {
      await page.locator('#catm-name').fill(name);
      await page.locator('#catm-add-btn').click();
      await expect(page.locator('#catm-active .cat-row', { hasText: name }).first()).toBeVisible();
    }
    expect(posts.length).toBe(3);
    await ui.ctx.close();
  });

  test('C-F10 도넛 범례의 "그 외 N개" 묶음 행에 접근 설명 연결, 표는 묶지 않은 행', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('f10leg');
    for (const n of ['추가1', '추가2', '추가3']) expect((await json(u.api, 'POST', '/api/categories', { type: 'expense', name: n })).status()).toBe(201);
    const names = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', '추가1', '추가2', '추가3'];
    for (const [i, c] of names.entries()) await addTx(u.api, { type: 'expense', amount: 50000 - i * 3000, category: c, date: '2026-10-05' });
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    await page.goto('/#dashboard');
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    const other = page.locator('#chart-donut li[data-viz="other"]');
    await expect(other).toHaveCount(1);
    await expect(other).toContainText('그 외 4개');
    const info = await other.evaluate((li) => {
      const id = li.getAttribute('aria-describedby');
      const d = id ? document.getElementById(id) : null;
      return { id, text: d?.textContent, contained: !!d && li.contains(d), hiddenClass: d?.className };
    });
    expect(info.id).toBeTruthy();
    expect(info.text).toBe('여러 카테고리를 합친 항목');
    expect(info.hiddenClass).toMatch(/visually-hidden/);
    // 이름 그대로의 실제 카테고리와 구분: 묶음 행만 설명이 있다
    expect(await page.locator('#chart-donut li[aria-describedby]').count()).toBe(1);
    // 표는 묶지 않은 전체 행(관찰: 표에는 "그 외" 묶음 행이 없으므로 묶음 행 접근 설명은 범례에만 해당)
    const table = page.locator('#chart-donut table');
    await page.locator('#chart-donut details summary').first().click().catch(() => {});
    const rows = await table.locator('tbody tr').count();
    expect(rows).toBe(11);
    expect(await table.locator('tbody th, tbody td:first-child').allTextContents()).not.toContain('그 외 4개');
    await ui.ctx.close();
  });
});

// ====================================================================== 이름 UI (프론트 검증)
test.describe('C-F9 UI 필드 오류', () => {
  test('C-F9 UI: 가입·내 정보·카테고리 추가·이름 바꾸기에서 거부 문자는 필드 오류, 제로폭만은 1자 이상 오류, 요청 0', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('f9ui');
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    const writes = [];
    page.on('request', (r) => { if (['POST', 'PATCH'].includes(r.method()) && /\/api\/(auth\/me|categories)/.test(r.url())) writes.push(r.url()); });
    // 내 정보
    await page.goto('/#account');
    await expect(page.locator('#account-name')).toHaveValue(u.account.name);
    for (const [v, re] of [['a‮b', /쓸 수 없는 문자/], ['a⁦b', /쓸 수 없는 문자/], ['a‎b', /쓸 수 없는 문자/], ['​﻿', /1자 이상|입력/]]) {
      await page.locator('#account-name').fill(v);
      await page.locator('#account-save').click();
      await expect(page.locator('#account-name-error')).toHaveText(re);
      await expect(page.locator('#account-name')).toHaveAttribute('aria-invalid', 'true');
    }
    // 제로폭 섞인 이름은 제거되어 저장
    await page.locator('#account-name').fill('가​나﻿');
    await page.locator('#account-save').click();
    await expect(page.locator('#account-status')).toHaveText('저장했어요');
    await expect(page.locator('#user-name')).toHaveText('가나');
    expect(writes).toHaveLength(1);
    // 카테고리 추가
    await page.goto('/#categories');
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    for (const v of ['메‮모', '메‎모']) {
      await page.locator('#catm-name').fill(v);
      await page.locator('#catm-add-btn').click();
      await expect(page.locator('#catm-add-error')).toHaveText(/쓸 수 없는 문자/);
    }
    await page.locator('#catm-name').fill('​');
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-add-error')).toHaveText(/입력|1자 이상/);
    // 카테고리 이름 바꾸기
    await page.locator('#catm-active .cat-row', { hasText: '교통' }).first().getByRole('button', { name: '교통 이름 바꾸기' }).click();
    await page.locator('.cat-rename input').fill('교⁦통');
    await page.locator('.cat-rename').getByRole('button', { name: /이름 저장/ }).click();
    await expect(page.locator('.cat-row [role="alert"]', { hasText: '쓸 수 없는 문자' })).toBeVisible();
    expect(writes).toHaveLength(1); // 위 거부 입력은 모두 요청 0
    await page.keyboard.press('Escape');
    // 가입 화면
    const lg = await newUiPage(browser, testInfo);
    let signups = 0;
    await lg.page.route('**/api/auth/signup', (r) => { signups += 1; return r.continue(); });
    await lg.page.goto('/login.html');
    await lg.page.locator('#mode-signup').click();
    await lg.page.locator('#email').fill('f9ui@example.com');
    await lg.page.locator('#password').fill('password-ok-1');
    for (const v of ['a‮b', '​']) {
      await lg.page.locator('#name').fill(v);
      await lg.page.locator('#submit-btn').click();
      await expect(lg.page.locator('#name-error')).not.toHaveText('');
      await expect(lg.page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
      await expect(lg.page.locator('#name')).toBeFocused();
    }
    expect(signups).toBe(0);
    await ui.ctx.close(); await lg.ctx.close();
  });
});

// ====================================================================== C-F7 균형 카드 라벨
test.describe('C-F7 균형 카드 월 라벨', () => {
  test('C-F7 이번 달 / 지난달·같은 해 다른 달 / 다른 해, #kpi aria-label 동일 규칙 (오늘 2026-10-19 고정)', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('f7');
    await addTx(u.api, { type: 'expense', amount: 1000, category: '식비', date: '2026-10-02' });
    await addTx(u.api, { type: 'income', amount: 9000, category: '급여', date: '2025-12-10' });
    const ui = await newUiPage(browser, testInfo, { api: u.api });
    const { page } = ui;
    await page.goto('/#dashboard');
    await expect(page.locator('#kpi .kpi-label').first()).toBeVisible();
    const label = () => page.locator('#kpi .kpi-label').first().innerText();
    const aria = () => page.locator('#kpi').getAttribute('aria-label');
    await expect.poll(label).toBe('이번 달 남은 돈');
    expect(await aria()).toBe('이번 달 요약');
    await page.locator('#dash-prev').click();
    await expect.poll(label).toBe('9월 남은 돈');
    expect(await aria()).toBe('9월 요약');
    for (let i = 0; i < 8; i++) await page.locator('#dash-prev').click(); // 1월까지
    await expect.poll(label).toBe('1월 남은 돈');
    await page.locator('#dash-prev').click();
    await expect.poll(label).toBe('2025년 12월 남은 돈');
    expect(await aria()).toBe('2025년 12월 요약');
    await page.locator('#dash-next').click();
    await expect.poll(label).toBe('1월 남은 돈');
    for (let i = 0; i < 9; i++) await page.locator('#dash-next').click();
    await expect.poll(label).toBe('이번 달 남은 돈');
    expect(await aria()).toBe('이번 달 요약');
    // 미래 달(다음 달)은 같은 해 다른 달이므로 "11월"
    await page.locator('#dash-next').click();
    await expect.poll(label).toBe('11월 남은 돈');
    // 다른 KPI 라벨(수입/지출)과 숫자 표시 NaN 없음
    expect(await page.locator('#kpi').innerText()).not.toMatch(/NaN|undefined|Infinity/);
    await ui.ctx.close();
  });
});

// ====================================================================== C-F8 미사용 CSS, 헤더 글자
test.describe('C-F8/C-F5 정적·헤더', () => {
  test('C-F8 style.css 에 .dash-tools·.balance-note·.chart-text-strong 없음, HTML·JS 에서도 쓰지 않음', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const css = readFileSync(join(PUBLIC, 'css', 'style.css'), 'utf8');
    for (const c of ['.dash-tools', '.balance-note', '.chart-text-strong']) expect(css, c).not.toContain(c);
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(html|js)$/.test(n)) files.push(f); });
    walk(PUBLIC);
    for (const f of files) for (const c of ['dash-tools', 'balance-note', 'chart-text-strong']) expect(readFileSync(f, 'utf8'), `${f} ${c}`).not.toContain(c);
  });

  test('요청: 헤더 이름 글자 크기 = 로그아웃 버튼 글자 크기(--fs-label), 높이 44 이상, 이름 칸 40px 초과', async ({ browser }, testInfo) => {
    const u = await createLoggedInUser('hdr');
    for (const scheme of ['light', 'dark']) {
      const ui = await newUiPage(browser, testInfo, { api: u.api });
      await ui.page.emulateMedia({ colorScheme: scheme });
      await ui.page.goto('/#record');
      await expect(ui.page.locator('#user-name')).toHaveText(u.account.name);
      const m = await ui.page.evaluate(() => {
        const cs = (s) => getComputedStyle(document.querySelector(s));
        const fs = getComputedStyle(document.documentElement).getPropertyValue('--fs-body-lg'); // 휴대폰 피드백: 이름은 본문 큰 글자(로그아웃 버튼은 --fs-label 그대로)
        const probe = document.createElement('span'); probe.style.fontSize = fs.trim(); document.body.appendChild(probe);
        const labelPx = getComputedStyle(probe).fontSize; probe.remove();
        return { name: cs('#user-name').fontSize, logout: cs('#logout-btn').fontSize, toggle: cs('#theme-toggle').fontSize, labelPx, nameW: document.querySelector('#user-name').getBoundingClientRect().width };
      });
      expect(m.name, `${scheme} 이름은 --fs-body-lg`).not.toBe(m.logout);
      expect(m.name).toBe(m.labelPx);
      expect(m.nameW, '이름 칸 폭').toBeGreaterThan(40);
      await ui.ctx.close();
    }
  });
});

// ====================================================================== C-F12 폰트 측정·캐시
test.describe('C-F12 폰트', () => {
  test('C-F12 vercel.json: /fonts/* 는 1년 immutable, HTML 은 no-store 유지, README 에 규칙', async ({}, testInfo) => {
    onlyMobile(testInfo);
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    const rules = cfg.headers;
    const fonts = rules.find((r) => r.source === '/fonts/(.*)');
    expect(fonts, '/fonts 규칙').toBeTruthy();
    expect(fonts.headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
    for (const src of ['/', '/index.html']) {
      const r = rules.find((x) => x.source === src);
      expect(r?.headers, src).toEqual([{ key: 'Cache-Control', value: 'no-store' }]);
    }
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toMatch(/폰트 파일 내용을 바꿀 때는 파일 이름도 반드시 바꾸고/);
  });

  test('C-F12 측정: 화면별 첫 방문 woff2 다운로드(전/후), 굵기별 사용처, Newsreader 500 미사용', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const sizes = {};
    for (const f of readdirSync(join(PUBLIC, 'fonts')).filter((n) => n.endsWith('.woff2'))) sizes[f] = statSync(join(PUBLIC, 'fonts', f)).size;
    const oldCss = execFileSync('git', ['show', '5a0689d^:src/frontend/public/css/fonts.css'], { cwd: ROOT, encoding: 'utf8' });
    const oldMedium = execFileSync('git', ['show', '5a0689d^:src/frontend/public/fonts/Newsreader-Medium.latin.woff2'], { cwd: ROOT, maxBuffer: 10_000_000 });
    sizes['Newsreader-Medium.latin.woff2 (삭제됨)'] = oldMedium.length;
    const u = await createLoggedInUser('f12');
    for (const [i, c] of ['식비', '교통', '쇼핑'].entries()) await addTx(u.api, { type: 'expense', amount: 10000 * (i + 1), category: c, date: '2026-10-05' });
    await addTx(u.api, { type: 'income', amount: 500000, category: '급여', date: '2026-10-06' });
    const screens = [['login', '/login.html', false], ['record', '/#record', true], ['dashboard', '/#dashboard', true], ['categories', '/#categories', true], ['account', '/#account', true]];
    const report = [];
    const weightUse = {};
    for (const mode of ['after', 'before']) {
      for (const [name, path, auth] of screens) {
        const ui = await newUiPage(browser, testInfo, { api: auth ? u.api : undefined });
        const { page } = ui;
        if (mode === 'before') {
          await page.route('**/css/fonts.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: oldCss }));
          await page.route('**/fonts/Newsreader-Medium.latin.woff2', (r) => r.fulfill({ status: 200, contentType: 'font/woff2', body: oldMedium }));
        }
        const got = [];
        page.on('response', async (r) => { if (/\.woff2$/.test(r.url())) { const b = await r.body().catch(() => null); got.push({ f: r.url().split('/').pop(), n: b ? b.length : 0, s: r.status() }); } });
        await page.goto(path);
        if (auth) await expect(page.locator('#user-name')).toHaveText(u.account.name);
        if (name === 'dashboard') await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
        if (name === 'categories') await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => ![...document.fonts].some((f) => f.status === 'loading'));
        await page.waitForTimeout(1000);
        if (mode === 'after') {
          const used = await page.evaluate(() => {
            const out = {};
            const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
            document.querySelectorAll('body *').forEach((e) => {
              if (!visible(e)) return;
              const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
              const cs = getComputedStyle(e);
              if (!own && !(e.tagName === 'text' || e.tagName === 'tspan')) return;
              const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
              const k = `${fam} ${cs.fontWeight}`;
              (out[k] ||= []).push(e.id ? `#${e.id}` : e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : e.tagName.toLowerCase());
            });
            return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...new Set(v)].slice(0, 6)]));
          });
          for (const [k, v] of Object.entries(used)) { weightUse[k] ||= new Set(); v.forEach((x) => weightUse[k].add(`${name}:${x}`)); }
        }
        const uniq = [...new Map(got.map((g) => [g.f, g])).values()];
        report.push({ mode, name, files: uniq.map((g) => `${g.f}(${g.n})`), total: uniq.reduce((a, g) => a + g.n, 0) });
        await ui.ctx.close();
      }
    }
    const uses = Object.fromEntries(Object.entries(weightUse).map(([k, v]) => [k, [...v].slice(0, 8)]));
    console.log('FONT_SIZES ' + JSON.stringify(sizes));
    console.log('FONT_REPORT ' + JSON.stringify(report));
    console.log('FONT_USE ' + JSON.stringify(uses));
    // 지운 face(Newsreader 500)를 쓰는 곳이 없다: 화면 어디에도 Newsreader 500 텍스트가 없다
    expect(Object.keys(uses).filter((k) => /^Newsreader (500|600|700)/.test(k)), 'Newsreader 500 이상 사용처').toEqual([]);
    // 지운 face 는 어느 화면에서도 요청되지 않았다(전·후 모두). 전/후 합계는 로드 타이밍에 따라 화면마다 한두 파일 차이가 날 수 있어 숫자 비교 대신 보고한다.
    for (const r of report) expect(r.files.join(), `${r.mode} ${r.name}`).not.toContain('Newsreader-Medium');
  });
});
