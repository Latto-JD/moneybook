// docs/plan-design.md 11장 (C-D1~C-D40) 디자인 적용 검증. 360px(mobile-360)·768px(tablet-768) 에서 실행.
// 라이트 = colorScheme 'light', 다크 = page.emulateMedia({ colorScheme: 'dark' }). "오늘"은 2026-10-19 고정.
// 서버는 TRUST_PROXY=true. 시드 사용자(SEED_*)가 필요한 항목은 SEED_* 가 없으면 skip.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoggedInUser, addTx, get, json, newApi } from '../helpers/api.js';
import { newUiPage, expectNoHorizontalScroll, FIXED_TODAY } from '../helpers/ui.js';
import { SEED_EMAIL, SEED_PASSWORD, BASE_URL } from '../helpers/env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUBLIC = join(ROOT, 'src', 'frontend', 'public');
const HANDOFF = join(ROOT, 'design_handoff_moneybook', 'handoff');
const SHOTS = process.env.QA_SHOT_DIR || '';

const widthOf = (testInfo) => testInfo.project.use.viewport.width;
const SCHEMES = ['light', 'dark'];
const LIGHT = { bg: 'rgb(247, 245, 240)', text: 'rgb(27, 26, 23)', error: 'rgb(172, 58, 49)', focus: 'rgb(6, 88, 171)' };
const DARK = { bg: 'rgb(20, 20, 18)', text: 'rgb(238, 235, 227)', error: 'rgb(245, 147, 135)', focus: 'rgb(125, 182, 254)' };
const PAL = (scheme) => (scheme === 'dark' ? DARK : LIGHT);

// ------------------------------------------------------------------ 공통 준비
/** 로그인된 api 로 열기. scheme 은 라이트/다크, reduced 는 prefers-reduced-motion */
async function open(browser, testInfo, { api, scheme = 'light', hash = '#record', reduced = false, dialogs } = {}) {
  const ui = await newUiPage(browser, testInfo, { api, dialogs });
  const { page } = ui;
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  const problems = [];
  const bad = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => requests.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] || '' }));
  page.on('requestfailed', (r) => bad.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`/${hash}`);
  return { ...ui, problems, bad, requests };
}
const csp = (page) => page.evaluate(() => window.__csp || []);

async function seedApi() {
  const api = await newApi();
  expect((await json(api, 'POST', '/api/auth/login', { email: SEED_EMAIL, password: SEED_PASSWORD })).status()).toBe(200);
  return api;
}

const SCREENS = {
  record: { hash: '#record', ready: async (page) => { await expect(page.locator('#category-chips button').first()).toBeVisible(); await expect(page.locator('#tx-list .tx-row').first()).toBeVisible(); } },
  dashboard: { hash: '#dashboard', ready: async (page) => { await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible(); await expect(page.locator('#chart-monthly svg.chart-svg')).toBeVisible(); await expect(page.locator('#chart-cat-trend svg.chart-svg')).toBeVisible(); await expect(page.locator('#kpi .sum-balance').first()).toBeVisible(); } },
  categories: { hash: '#categories', ready: async (page) => { await expect(page.locator('#catm-active .cat-row').first()).toBeVisible(); } },
};
async function go(page, name) {
  await page.evaluate((h) => { location.hash = h; }, SCREENS[name].hash);
  await SCREENS[name].ready(page);
  await page.waitForTimeout(150);
}

// ------------------------------------------------------------------ 브라우저 안 검사 함수 (자체 완결)
function pageScan(fn) { return (page) => page.evaluate(fn); }

/** 색 대비: 글자가 있는 모든 보이는 요소. 비활성(aria-disabled/disabled)·placeholder 제외 */
const scanTextContrast = pageScan(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } }
    let acc = parse(getComputedStyle(document.body).backgroundColor); if (!acc || acc.a === 0) acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of stack.reverse()) acc = over(c, acc);
    return acc;
  };
  const out = [];
  let n = 0;
  for (const e of document.querySelectorAll('body *')) {
    const direct = [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
    if (!direct) continue;
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (e.closest('[aria-disabled="true"], :disabled, .visually-hidden, .skip-link')) continue;
    const isSvgText = e instanceof SVGElement;
    const fg = parse(isSvgText ? cs.fill : cs.color);
    if (!fg) continue;
    const bg = bgOf(e);
    const fgc = over(fg, bg);
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const c = ratio(fgc, bg);
    n++;
    if (c < need) out.push(`${e.tagName.toLowerCase()}.${(e.getAttribute('class') || '').slice(0, 30)} "${e.textContent.trim().slice(0, 14)}" ${c.toFixed(2)} < ${need}`);
  }
  return { n, out };
});

/** 비텍스트 대비: 입력·칩 테두리, 막대, 견본 vs 카드 배경 3:1 */
const scanNonText = pageScan(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const bgOf = (e) => { for (let n = e.parentElement; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a === 1) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden'; };
  const out = [];
  const seen = {};
  const check = (label, e, color, bg) => {
    const c = ratio(color, bg);
    seen[label] = Math.min(seen[label] ?? 99, c);
    if (c < 3) out.push(`${label} ${c.toFixed(2)}`);
  };
  for (const e of document.querySelectorAll('input.input, input.amount-input, .chip, .segmented, .amount-wrap')) {
    if (!vis(e) || e.closest('[hidden]')) continue;
    const cs = getComputedStyle(e);
    const side = e.matches('.amount-wrap') ? 'borderBottomColor' : 'borderTopColor';
    const bc = parse(cs[side]);
    if (!bc || bc.a === 0) continue;
    if (e.matches('.chip[aria-pressed="true"], .segmented')) continue; // 선택 칩은 채움으로, 세그먼트 트랙은 눌린 칸 구분으로 확인한다
    const bg = parse(cs.backgroundColor)?.a === 1 ? parse(cs.backgroundColor) : bgOf(e);
    check(`border:${e.tagName.toLowerCase()}.${(e.getAttribute('class') || '').split(' ')[0]}`, e, bc, bgOf(e));
    void bg;
  }
  for (const e of document.querySelectorAll('.bar-fill')) if (vis(e)) check(`bar:${e.className}`, e, parse(getComputedStyle(e).backgroundColor), bgOf(e));
  for (const e of document.querySelectorAll('svg .donut__slice')) {
    // 도넛 조각: 패턴 안 색 rect (viz-fill-N) 또는 viz-other/ viz-fill-1 의 fill
    const f = e.getAttribute('fill');
    let color;
    if (f && f.startsWith('url(#')) { const pr = document.getElementById(f.slice(5, -1)).querySelector('rect'); color = parse(getComputedStyle(pr).fill); } else color = parse(getComputedStyle(e).fill);
    check(`slice:${e.getAttribute('data-viz')}`, e, color, bgOf(e));
  }
  return { out, seen };
});

/** 가로 스크롤/터치 대상 */
const scanTargets = pageScan(() => {
  const out = [];
  const sel = 'button, a[href], summary, [role=button], [role=tab], .chip';
  for (const b of document.querySelectorAll(sel)) {
    if (b.closest('[hidden]') || b.matches('.skip-link')) continue;
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.width < 43.5 || r.height < 43.5) out.push(`${b.tagName.toLowerCase()}#${b.id || ''}.${(b.getAttribute('class') || '').split(' ')[0]} "${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 14)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});

/** 오류 색 범위 (C-D10) */
const scanErrorScope = (page, errColor) => page.evaluate((ERR) => {
  const bad = [];
  const props = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'fill', 'stroke', 'outlineColor', 'boxShadow'];
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('.error-text, .field__error, .btn-danger, .btn--danger, [aria-invalid="true"]')) continue;
    if (e.matches('.amount-wrap') && e.querySelector('[aria-invalid="true"]')) continue;
    const cs = getComputedStyle(e);
    for (const p of props) if (cs[p] && cs[p].includes(ERR)) bad.push(`${e.tagName.toLowerCase()}.${(e.getAttribute('class') || '').toString().slice(0, 24)} ${p}=${cs[p]}`);
    for (const a of ['fill', 'stroke']) { const v = e.getAttribute(a); if (v && /#ac3a31|#f59387/i.test(v)) bad.push(`${e.tagName} attr ${a}=${v}`); }
  }
  return bad;
}, errColor);

// ================================================================== 11.1 자산 · CSP
test.describe('11.1 자산 · CSP', () => {
  test('C-D1 / C-F11 / C-F12 자산: 원본(design_handoff_moneybook/handoff)과 같되 의도한 차이만 (fonts.css 의 Newsreader 500 한 줄, Medium 폰트 파일, SVG 메타데이터, 새 아이콘 2개)', async () => {
    const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
    const same = (rel, dstRel = rel) => {
      const a = readFileSync(join(HANDOFF, rel));
      const b = readFileSync(join(PUBLIC, dstRel));
      expect(Buffer.compare(a, b), `${rel} 다름`).toBe(0);
    };
    // 재검증 4(사용자 요청): 원본에서 의도한 차이만 허용한다 - 다크 금색 선 토큰(--color-line/--color-border 값 교체, field-line 2개 추가), 초기화 아이콘 클래스 1줄
    const fileLines = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
    for (const [name, removed, added] of [
      ['tokens.css', ['--color-line:           #33312C;', '--color-border:         #7A766D;', '--color-line: #33312C; --color-border: #7A766D; --color-border-strong: #EEEBE3;'],
        ['--color-field-line:        var(--color-line);  /* 금액 입력 밑줄 */', '--color-field-line-active: var(--color-focus); /* 입력 중 밑줄 */', '--color-line:           #4B4231; /* 금색 계열 구분선 (장식) */', '--color-border:         #9A7E4A; /* 금색 테두리: 카드 4.4 / 눌린 면 3.8 */', '--color-field-line:        #9A7E4A;', '--color-field-line-active: var(--color-focus); /* 포커스 표시는 라이트와 같이 파랑 */', '--color-line: #4B4231; --color-border: #9A7E4A; --color-border-strong: #EEEBE3;', '--color-field-line: #9A7E4A; --color-field-line-active: var(--color-focus);']],
      ['components.css', [], ['.icon--reset    { --icon: url("../icons/reset.svg"); }']],
    ]) {
      const a = fileLines(join(HANDOFF, name)); const b = fileLines(join(PUBLIC, 'css', name));
      expect(a.filter((l) => !b.includes(l)), `${name} 원본에서 사라진 줄`).toEqual(removed);
      expect(b.filter((l) => !a.includes(l)), `${name} 새로 생긴 줄`).toEqual(added);
    }
    // fonts.css: 원본에서 Newsreader 500 @font-face 한 줄만 뺀 것과 같다
    const lines = read(HANDOFF, 'fonts.css').split(/\r?\n/);
    const dropped = lines.filter((l) => /font-family: "Newsreader"; font-weight: 500/.test(l));
    expect(dropped, '원본의 Newsreader 500 face').toHaveLength(1);
    const expectedCss = lines.filter((l) => !dropped.includes(l)).join('\n').replace(/\s+$/, '');
    expect(read(PUBLIC, join('css', 'fonts.css')).replace(/\r\n/g, '\n').replace(/\s+$/, '')).toBe(expectedCss.replace(/\r\n/g, '\n'));
    const fonts = readdirSync(join(HANDOFF, 'fonts'));
    expect(fonts.filter((f) => f.endsWith('.woff2'))).toHaveLength(6);
    expect(fonts.filter((f) => f.startsWith('OFL-'))).toHaveLength(2);
    const pubFonts = readdirSync(join(PUBLIC, 'fonts'));
    expect(pubFonts.filter((f) => f.endsWith('.woff2')).sort(), '배포 폰트는 원본에서 Newsreader-Medium 만 뺀 5개').toEqual(fonts.filter((f) => f.endsWith('.woff2') && f !== 'Newsreader-Medium.latin.woff2').sort());
    expect(pubFonts).not.toContain('Newsreader-Medium.latin.woff2');
    // OFL-Newsreader.txt 는 원본이 91바이트 안내 문구뿐이라 정식 OFL 본문으로 교체했다: 바이트 비교 대신 본문 내용을 확인한다
    for (const f of fonts.filter((n) => n !== 'OFL-Newsreader.txt' && n !== 'Newsreader-Medium.latin.woff2')) same(join('fonts', f));
    const ofl = readFileSync(join(PUBLIC, 'fonts', 'OFL-Newsreader.txt'), 'utf8');
    expect(ofl.length).toBeGreaterThanOrEqual(1000);
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(ofl).toContain('Newsreader Project Authors');
    // SVG: 메타데이터(<metadata>, xmlns:c2pa)만 뺀 내용이 원본과 같고, 배포본에는 c2pa·<metadata 문자열이 없다
    const strip = (t) => t.replace(/<metadata[\s\S]*?<\/metadata>/g, '').replace(/\sxmlns:c2pa="[^"]*"/g, '');
    const icons = readdirSync(join(HANDOFF, 'icons')).filter((f) => f.endsWith('.svg'));
    expect(icons).toHaveLength(15);
    const pats = readdirSync(join(HANDOFF, 'patterns')).filter((f) => f.endsWith('.svg'));
    expect(pats).toHaveLength(7);
    for (const [dir, list] of [['icons', icons], ['patterns', pats]]) {
      for (const f of list) {
        const pub = read(PUBLIC, join(dir, f));
        expect(pub, `${dir}/${f} 메타데이터 잔존`).not.toMatch(/c2pa|<metadata/i);
        expect(pub, `${dir}/${f} 내용`).toBe(strip(read(HANDOFF, join(dir, f))));
      }
    }
    const pubIcons = readdirSync(join(PUBLIC, 'icons')).filter((f) => f.endsWith('.svg'));
    expect(pubIcons, '배포 아이콘 19개 = 원본 15 + theme 2 + reset 1 + logout 1').toHaveLength(19);
    expect(pubIcons.filter((f) => !icons.includes(f)).sort()).toEqual(['logout.svg', 'reset.svg', 'theme-dark.svg', 'theme-light.svg']);
    expect(readdirSync(join(PUBLIC, 'patterns')).filter((f) => f.endsWith('.svg'))).toHaveLength(7);
    // 배포 svg 22개 + 새 3개: 메타데이터 문자열 없음
    for (const dir of ['icons', 'patterns']) for (const f of readdirSync(join(PUBLIC, dir)).filter((n) => n.endsWith('.svg'))) expect(read(PUBLIC, join(dir, f)), `${dir}/${f}`).not.toMatch(/c2pa|<metadata/i);
    // public/ 에 있는 자산 중 원본에 없는 것은 theme 아이콘 3개뿐
    for (const dir of ['fonts', 'icons', 'patterns']) {
      const extra = readdirSync(join(PUBLIC, dir)).filter((f) => !readdirSync(join(HANDOFF, dir)).includes(f) && !(dir === 'icons' && /^(theme-(light|dark)|reset|logout)\.svg$/.test(f)));
      expect(extra, `${dir} 여분 파일`).toEqual([]);
    }
  });

  test('C-D5 정적 검사: html 인라인 script/on*=/style=/<style>/data:/외부 URL 없음, js 위험 API 없음, css url() 은 같은 출처 상대 경로', async () => {
    for (const f of ['index.html', 'login.html']) {
      const html = readFileSync(join(PUBLIC, f), 'utf8');
      for (const m of html.matchAll(/<script\b([^>]*)>/gi)) expect(m[1], `${f} script`).toMatch(/\bsrc\s*=/i);
      expect(html, f).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
      expect(html, f).not.toMatch(/<[^>]+\sstyle\s*=/i);
      expect(html, f).not.toMatch(/<style\b/i);
      expect(html, f).not.toMatch(/data:/i);
      expect(html, f).not.toMatch(/(?:src|href|action)\s*=\s*["'](?:https?:)?\/\//i);
    }
    // 서버가 실제로 내려주는 본문도 같은지 (정적 파일 서빙 경로)
    const api = await newApi();
    for (const f of ['/', '/login.html']) {
      const html = await (await get(api, f)).text();
      expect(html).not.toMatch(/<style\b|<[^>]+\sstyle\s*=|<[^>]+\son[a-z]+\s*=/i);
    }
    const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const jsFiles = walk(join(PUBLIC, 'js')).filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(10);
    for (const f of jsFiles) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(/);
    }
    for (const f of ['style.css', 'components.css', 'tokens.css', 'fonts.css']) {
      const css = readFileSync(join(PUBLIC, 'css', f), 'utf8');
      for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)) {
        expect(m[2], `${f} url(${m[2]})`).not.toMatch(/^(?:data:|https?:|\/\/)/i);
        expect(m[2], `${f} url(${m[2]})`).toMatch(/^(?:\.\.\/)?(?:fonts|icons|patterns)\/[\w.-]+\.(?:woff2|svg)$|^#/);
      }
    }
  });

  test('C-D6 하드코딩 색 0: style.css 와 js 에 hex·rgb( 없음 (tokens.css 제외, components.css 의 견본 inset rgba 1건만 허용)', async () => {
    const style = readFileSync(join(PUBLIC, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(style).not.toMatch(/\brgba?\(|\bhsla?\(/);
    const comp = readFileSync(join(PUBLIC, 'css', 'components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(comp.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
    expect(comp.match(/rgba?\([^)]*\)/g) || []).toEqual(['rgba(0,0,0,.08)']);
    const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of walk(join(PUBLIC, 'js')).filter((x) => x.endsWith('.js'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]|\brgba?\(\s*\d/);
    }
  });

  for (const scheme of SCHEMES) {
    test(`C-D2/C-D3/C-D4 [${scheme}] 전 흐름 동안 콘솔·CSP·페이지 오류 0, 모든 요청 같은 출처·폰트 woff2 MIME·자산 200, 폰트 적용`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      const { api } = await createLoggedInUser('dsg');
      for (const c of ['식비', '교통', '쇼핑']) await addTx(api, { category: c, amount: 12000, memo: `${c}메모`, date: '2026-10-05' });
      await addTx(api, { type: 'income', category: '급여', amount: 2000000, date: '2026-10-02' });
      const dialogs = [];
      const { ctx, page, problems, bad, requests } = await open(browser, testInfo, { api, scheme, dialogs });
      page.removeAllListeners('dialog');
      page.on('dialog', (d) => d.accept());
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      // 기록: 빠른 금액 -> 저장 -> 수정 -> 삭제
      await page.locator('.quick-amounts [data-add="10000"]').click();
      await page.locator('#category-chips button', { hasText: '식비' }).click();
      await page.locator('#save-btn').click();
      await expect(page.locator('#flash')).toHaveText('저장했어요');
      await page.locator('.tx-edit').first().click();
      await page.locator('#amount').fill('7000');
      await page.locator('#save-btn').click();
      await expect(page.locator('#flash')).toHaveText('수정했어요');
      await page.locator('.tx-del').first().click();
      await expect(page.locator('#flash')).toHaveText('삭제했어요');
      await page.locator('#month-prev').click();
      await page.locator('#month-next').click();
      // 대시보드: 월 이동, 카테고리 보기, 표로 보기, 6/12개월
      await page.locator('#tab-dashboard').click();
      await SCREENS.dashboard.ready(page);
      await page.locator('#dash-prev').click();
      await page.locator('#dash-next').click();
      await page.locator('#catview-income').click();
      await page.locator('#chart-donut details summary').click();
      await page.locator('#catview-expense').click();
      await page.locator('#range-12').click();
      await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
      // 카테고리 관리: 추가, 이름 변경, 사용 안 함, 다시 사용
      await page.locator('#panel-dashboard a[href="#categories"]').click();
      await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
      await page.locator('#catm-name').fill('반려동물');
      await page.locator('#catm-add-btn').click();
      await expect(page.locator('#catm-status')).toContainText('추가했어요');
      await page.getByRole('button', { name: '반려동물 이름 바꾸기' }).click();
      await page.locator('.cat-rename input').fill('고양이');
      await page.locator('.cat-rename input').press('Enter');
      await expect(page.locator('#catm-status')).toContainText('고양이');
      await page.getByRole('button', { name: '고양이 사용 안 함' }).click();
      await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
      await page.locator('#catm-inactive-details summary').click();
      await page.locator('#catm-inactive').getByRole('button', { name: /다시 사용/ }).first().click();
      await expect.poll(() => page.locator('#catm-active .cat-name').allTextContents()).toContain('고양이');
      // 로그아웃 후 로그인 화면도 확인
      const loginCtx = await browser.newContext({ baseURL: BASE_URL, viewport: testInfo.project.use.viewport, colorScheme: scheme }); // 로그인 상태면 login.html 이 앱으로 돌려보내므로 새 컨텍스트
      await loginCtx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
      const loginPage = await loginCtx.newPage();
      loginPage.on('console', (m) => { if ((m.type() === 'error' && !/status of 401/.test(m.text())) || /Content Security Policy/i.test(m.text())) problems.push(`login console: ${m.text()}`); }); // 로그아웃 상태의 세션 확인 401 은 정상
      loginPage.on('response', (r) => requests.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] || '' }));
      await loginPage.goto('/login.html');
      await expect(loginPage.locator('#auth-title')).toBeVisible();
      await expect(loginPage.locator('#submit-btn')).toBeVisible();
      expect(await loginPage.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(PAL(scheme).bg);
      expect(await loginPage.evaluate(() => window.__csp || [])).toEqual([]);
      await loginCtx.close();

      expect(problems, '콘솔/페이지 오류').toEqual([]);
      expect(bad, '실패한 요청').toEqual([]);
      expect(await csp(page), 'securitypolicyviolation').toEqual([]);
      const origin = new URL(BASE_URL).origin;
      expect(requests.filter((r) => new URL(r.url).origin !== origin).map((r) => r.url), '외부 출처 요청').toEqual([]);
      const fonts = requests.filter((r) => r.url.endsWith('.woff2'));
      expect(fonts.length, 'woff2 로드 수').toBeGreaterThan(0);
      for (const f of fonts) { expect(f.status, f.url).toBe(200); expect(f.type, f.url).toMatch(/^font\/woff2/); }
      const svgs = requests.filter((r) => /\/(icons|patterns)\/[\w-]+\.svg$/.test(r.url));
      expect(svgs.length, '아이콘/무늬 svg 요청').toBeGreaterThan(5);
      for (const s of svgs) expect(s.status, s.url).toBe(200);
      expect(requests.filter((r) => /\/patterns\//.test(r.url)).length, '무늬 svg 로드').toBeGreaterThan(0);
      test.info().annotations.push({ type: `fonts-${scheme}`, description: fonts.map((f) => f.url.split('/').pop()).join(',') });
      await ctx.close();
    });

    test(`C-D4 [${scheme}] document.fonts.check Pretendard/Newsreader 가 true, 금액 입력 font-family 첫 항목 Newsreader`, async ({ browser }, testInfo) => {
      const { api } = await createLoggedInUser('dft');
      const { ctx, page } = await open(browser, testInfo, { api, scheme });
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(async () => {
        await document.fonts.load('16px Pretendard', '가');
        await document.fonts.load('36px Newsreader', '0123');
        return {
          p: document.fonts.check('16px Pretendard'), n: document.fonts.check('36px Newsreader'),
          fam: getComputedStyle(document.getElementById('amount')).fontFamily,
          loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
        };
      });
      expect(r.p).toBe(true);
      expect(r.n).toBe(true);
      expect(r.fam.split(',')[0].replace(/["']/g, '').trim()).toBe('Newsreader');
      test.info().annotations.push({ type: `fonts-loaded-${scheme}`, description: r.loaded.join(' | ') });
      await ctx.close();
    });
  }
});

// ================================================================== 11.2 토큰 · 다크 · 균형
test.describe('11.2 토큰 · 다크 · 균형', () => {
  test.skip(!(SEED_EMAIL && SEED_PASSWORD), 'SEED_* 필요');
  for (const scheme of SCHEMES) {
    test(`C-D7 [${scheme}] body 배경·글자색`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme });
      await SCREENS.record.ready(page);
      const c = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color }));
      expect(c).toEqual({ bg: PAL(scheme).bg, color: PAL(scheme).text });
      await ctx.close();
    });

    test(`C-D8/C-D9/C-D10 [${scheme}] 세 화면: 흰 배경·옛 하드코딩 색 0, 글자·비텍스트 대비, 오류 색 범위`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme });
      const P = PAL(scheme);
      const report = [];
      for (const name of ['record', 'dashboard', 'categories']) {
        await go(page, name);
        if (name === 'record') { await page.locator('#save-btn').click({ force: true }); await expect(page.locator('#amount-error')).not.toHaveText(''); await page.mouse.move(2, 2); /* 움직임 줄이기에서는 hover 색(다크 --color-primary-hover)이 즉시 적용되므로 포인터를 치운다 */ }
        if (name === 'dashboard') { await page.locator('#chart-donut details summary').click(); await page.locator('#chart-monthly details summary').click(); }
        // C-D8: 다크에서 흰 배경 / 옛 SVG 색
        const old = await page.evaluate(() => {
          const out = [];
          for (const e of document.querySelectorAll('body *')) {
            const r = e.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const cs = getComputedStyle(e);
            if (cs.backgroundColor === 'rgb(255, 255, 255)') out.push(`${e.tagName.toLowerCase()}.${(e.getAttribute('class') || '').toString().slice(0, 24)} bg white`);
            if (e instanceof SVGElement) {
              for (const a of ['fill', 'stroke']) {
                const v = (e.getAttribute(a) || '').toLowerCase();
                if (['#fff', '#ffffff', '#333', '#333333', '#555', '#555555', '#d0d4da'].includes(v)) out.push(`svg ${e.tagName} attr ${a}=${v}`);
                if (['rgb(51, 51, 51)', 'rgb(85, 85, 85)', 'rgb(208, 212, 218)'].includes(cs[a])) out.push(`svg ${e.tagName} computed ${a}=${cs[a]}`);
              }
            }
          }
          return out;
        });
        if (scheme === 'dark') expect(old, `${name} 다크 잔존 하드코딩`).toEqual([]);
        else expect(old.filter((x) => x.startsWith('svg')), `${name} 옛 SVG 색`).toEqual([]);
        const t = await scanTextContrast(page);
        const nt = await scanNonText(page);
        report.push(`${name}: 글자 ${t.n}개 최저위반 ${t.out.length}, 비텍스트 최저 ${JSON.stringify(nt.seen)}`);
        expect.soft(t.out, `${name} ${scheme} 글자 대비 4.5(큰 글자 3) 미달`).toEqual([]);
        expect.soft(nt.out, `${name} ${scheme} 비텍스트 3:1 미달`).toEqual([]);
        // C-D10
        expect.soft(await scanErrorScope(page, P.error), `${name} ${scheme} 오류 색이 오류 외 요소에`).toEqual([]);
      }
      test.info().annotations.push({ type: `contrast-${scheme}`, description: report.join(' || ') });
      await ctx.close();
    });
  }

  test('C-D9 포커스 링 색 대 배경 3:1 이상 (라이트·다크 토큰)', async () => {
    const css = readFileSync(join(PUBLIC, 'css', 'tokens.css'), 'utf8');
    const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const dark = css.indexOf('@media (prefers-color-scheme: dark)');
    const pick = (blk, n) => new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`).exec(blk)[1];
    const [L, D] = [css.slice(0, dark), css.slice(dark)];
    for (const [blk, name] of [[L, 'light'], [D, 'dark']]) {
      for (const bg of ['--color-bg', '--color-surface']) expect(cr(pick(blk, '--color-focus'), pick(blk, bg)), `${name} focus vs ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  for (const scheme of SCHEMES) {
    test(`C-D11 [${scheme}] 수입 --color-income / 지출 --color-expense, 금액마다 기호·배지·아이콘 둘 이상 + aria-label`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme });
      await SCREENS.record.ready(page);
      const tok = () => page.evaluate(() => {
        const t = document.createElement('i'); document.body.appendChild(t);
        const rs = {};
        for (const k of ['income', 'expense']) { t.style.color = `var(--color-${k})`; rs[k] = getComputedStyle(t).color; }
        t.remove();
        return rs;
      });
      const T = await tok();
      expect(T.income).not.toBe(T.expense);
      // 월 요약
      const cells = await page.locator('#month-totals .sum-col').evaluateAll((els) => els.map((e) => ({
        label: e.querySelector('.sum-label').textContent.trim(), icon: !!e.querySelector('.sum-label .icon'),
        color: getComputedStyle(e.querySelector('.sum-amount')).color, aria: e.querySelector('.sum-amount').getAttribute('aria-label'), text: e.querySelector('.sum-amount').textContent,
      })));
      expect(cells).toHaveLength(2);
      expect(cells[0].color).toBe(T.income);
      expect(cells[1].color).toBe(T.expense);
      for (const c of cells) { expect(c.icon).toBe(true); expect(c.aria).toMatch(/(수입|지출) [\d,]+원$/); }
      // 목록 행
      const rows = await page.locator('#tx-list .tx-row').evaluateAll((els) => els.slice(0, 40).map((e) => {
        const a = e.querySelector('.tx-amount'); const b = e.querySelector('.tx-kind');
        return { cls: a.className, text: a.textContent, aria: a.getAttribute('aria-label'), color: getComputedStyle(a).color, badge: b.textContent.trim(), badgeIcon: !!b.querySelector('.icon') };
      }));
      expect(rows.length).toBeGreaterThan(5);
      for (const r of rows) {
        const inc = r.cls.includes('income');
        expect(r.text).toMatch(inc ? /^\+[\d,]+원$/ : /^−[\d,]+원$/); // 기호 (U+2212)
        expect(r.aria).toMatch(inc ? /^수입 [\d,]+원$/ : /^지출 [\d,]+원$/);
        expect(r.color).toBe(inc ? T.income : T.expense);
        expect(r.badge).toBe(inc ? '수입' : '지출');
        expect(r.badgeIcon).toBe(true);
      }
      // 대시보드 균형 카드
      await go(page, 'dashboard');
      const kp = await page.locator('#kpi .sum-col').evaluateAll((els) => els.map((e) => ({
        kind: e.className, icon: !!e.querySelector('.sum-label .icon'), label: e.querySelector('.sum-label').textContent.trim(),
        aria: e.querySelector('.sum-amount').getAttribute('aria-label'), color: getComputedStyle(e.querySelector('.sum-amount')).color, text: e.querySelector('.sum-amount').textContent,
      })));
      expect(kp).toHaveLength(2);
      expect(kp[0].color).toBe(T.income);
      expect(kp[1].color).toBe(T.expense);
      for (const k of kp) { expect(k.icon).toBe(true); expect(k.aria).toMatch(/(수입|지출) [\d,]+원$/); }
      // 부호 기호 없이 라벨(수입/지출)+아이콘 2가지 (남은 돈은 음수일 때만 U+2212)
      await ctx.close();
    });
  }

  for (const scheme of SCHEMES) {
    test(`C-D12 [${scheme}] prefers-reduced-motion: reduce 에서 버튼·칩·입력 transition-duration 모두 0s`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme, reduced: true });
      const bad = [];
      for (const name of ['record', 'dashboard', 'categories']) {
        await go(page, name);
        bad.push(...await page.evaluate((nm) => [...document.querySelectorAll('button, .btn, .chip, input, a.tabbar__item, summary, .segmented__item')].filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => ({ e, d: getComputedStyle(e).transitionDuration, a: getComputedStyle(e).animationDuration }))
          .filter((x) => !x.d.split(',').every((v) => parseFloat(v) === 0) || !x.a.split(',').every((v) => parseFloat(v) === 0))
          .map((x) => `${nm}: ${x.e.tagName.toLowerCase()}#${x.e.id}.${(x.e.getAttribute('class') || '').split(' ')[0]} t=${x.d} a=${x.a}`), name));
      }
      expect(bad).toEqual([]);
      // 대조: 모션 허용일 때는 0s 가 아닌 요소가 있다 (검사가 의미 있음)
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const any = await page.evaluate(() => [...document.querySelectorAll('button, .btn, .chip, input')].some((e) => !getComputedStyle(e).transitionDuration.split(',').every((v) => parseFloat(v) === 0)));
      expect(any, '모션 허용 상태에서 전환이 하나도 없으면 이 검사는 의미가 없다').toBe(true);
      await ctx.close();
    });
  }
});

// ================================================================== 11.3 공통 컴포넌트 · 접근성
test.describe('11.3 공통 컴포넌트 · 접근성', () => {
  test.skip(!(SEED_EMAIL && SEED_PASSWORD), 'SEED_* 필요');

  for (const scheme of SCHEMES) {
    test(`C-D13 [${scheme}] 세 화면의 모든 버튼·칩·링크·탭·summary 44x44 이상, #save-btn 높이 52 이상`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme });
      const found = {};
      for (const name of ['record', 'dashboard', 'categories']) {
        await go(page, name);
        if (name === 'dashboard') { await page.locator('#chart-donut details summary').click(); await page.locator('#range-12').click(); await page.waitForTimeout(200); }
        found[name] = await scanTargets(page);
        if (name === 'categories') {
          await page.locator('#catm-active .cat-row').first().getByRole('button', { name: /이름 바꾸기/ }).click();
          found.catRename = await scanTargets(page);
          await page.keyboard.press('Escape');
        }
      }
      await go(page, 'record');
      const h = await page.locator('#save-btn').evaluate((e) => e.getBoundingClientRect().height);
      expect(h, '#save-btn 높이').toBeGreaterThanOrEqual(52);
      expect.soft(found, '44px 미만 대상').toEqual({ record: [], dashboard: [], categories: [], catRename: [] });
      await ctx.close();
    });

    test(`C-D14 [${scheme}] Tab 이동 시 모든 포커스 요소에 --color-focus 링(box-shadow)`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme });
      const want = PAL(scheme).focus;
      const failures = [];
      const altOnly = [];
      let total = 0;
      for (const name of ['record', 'dashboard', 'categories']) {
        await go(page, name);
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
        await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
        await page.evaluate(() => document.activeElement?.blur());
        const seen = new Set();
        for (let i = 0; i < 120; i++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(260); // 전환(transition) 이 끝난 뒤의 값을 본다
          const info = await page.evaluate((FOCUS) => {
            const e = document.activeElement;
            if (!e || e === document.body) return null;
            const cs = getComputedStyle(e);
            const wrap = e.closest('.amount-wrap');
            const alt = [cs.borderTopColor, cs.borderBottomColor, wrap && getComputedStyle(wrap).borderBottomColor].some((c) => c === FOCUS);
            return { key: `${e.tagName}#${e.id}|${(e.textContent || '').trim().slice(0, 12)}|${e.getAttribute('aria-label') || ''}`, fv: e.matches(':focus-visible'), shadow: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, alt, tag: e.tagName, hiddenPanel: !!e.closest('[hidden]') };
          }, want);
          if (!info) continue;
          if (seen.has(info.key)) break;
          seen.add(info.key);
          total++;
          if (!info.shadow.includes(want) && info.alt) altOnly.push(info.key);
          if (!info.fv || !(info.shadow.includes(want) || info.alt)) failures.push(`${name}: ${info.key} fv=${info.fv} shadow=${info.shadow.slice(0, 50)} outline=${info.outline}`);
        }
      }
      test.info().annotations.push({ type: `focus-${scheme}`, description: `검사한 포커스 요소 ${total}개; box-shadow 링 대신 테두리색으로 표시: ${altOnly.join(', ')}` });
      expect(total).toBeGreaterThan(30);
      expect.soft(failures, '포커스 링 없는 요소').toEqual([]);
      await ctx.close();
    });
  }

  test('C-D15 선택 칩은 ✓ 아이콘, 선택 세그먼트는 카드 배경+그림자, aria-pressed="true" (라이트·다크)', async ({ browser }, testInfo) => {
    for (const scheme of SCHEMES) {
      const { api } = await createLoggedInUser('dpr');
      const { ctx, page } = await open(browser, testInfo, { api, scheme });
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      const chip = page.locator('#category-chips button', { hasText: '교통' });
      const other = page.locator('#category-chips button', { hasText: '식비' });
      const probe = (loc) => loc.evaluate((e) => { const i = e.querySelector('.icon--check'); const cs = i && getComputedStyle(i); const pm = i && getComputedStyle(i, '::before'); return { pressed: e.getAttribute('aria-pressed'), icon: !!i, w: i ? i.getBoundingClientRect().width : 0, disp: cs && cs.display, vis: cs && cs.visibility, op: cs && cs.opacity, mask: i && (cs.webkitMaskImage || cs.maskImage), bg: getComputedStyle(e).backgroundColor, content: pm && pm.content }; });
      const before = await probe(chip);
      await chip.click();
      const after = await probe(chip);
      const unsel = await probe(other);
      expect(after.pressed, scheme).toBe('true');
      expect(after.icon).toBe(true);
      expect(after.w, `${scheme} ✓ 폭`).toBeGreaterThan(8);
      expect(after.mask, `${scheme} ✓ 마스크`).toMatch(/check\.svg/);
      expect(after.bg, '선택 칩 배경이 달라야 함').not.toBe(unsel.bg);
      // 선택 전/비선택 칩의 ✓ 는 보이지 않아야 한다 (폭 0 또는 숨김)
      for (const p of [before, unsel]) expect(p.w === 0 || p.disp === 'none' || p.vis === 'hidden' || p.op === '0', `${scheme} 비선택 칩 ✓ 숨김 ${JSON.stringify(p)}`).toBe(true);
      // 세그먼트
      const seg = (id) => page.locator(id).evaluate((e) => { const cs = getComputedStyle(e); return { pressed: e.getAttribute('aria-pressed'), bg: cs.backgroundColor, shadow: cs.boxShadow }; });
      const exp = await seg('#type-expense');
      const inc = await seg('#type-income');
      expect(exp.pressed).toBe('true');
      expect(inc.pressed).toBe('false');
      const cardBg = await page.evaluate(() => { const t = document.createElement('i'); document.body.appendChild(t); t.style.color = 'var(--color-surface)'; const c = getComputedStyle(t).color; t.remove(); return c; }); // 폼은 카드 밖으로 나왔으므로 카드색 = --color-surface
      expect(exp.bg, `${scheme} 선택 세그먼트 배경 = 카드 배경`).toBe(cardBg);
      expect(exp.shadow).not.toBe('none');
      expect(inc.bg).not.toBe(cardBg);
      expect(inc.shadow).toBe('none');
      await ctx.close();
    }
  });

  test('C-D16 아이콘 span 은 모두 aria-hidden, 아이콘만 있는 버튼/링크는 접근 이름이 있다 (세 화면)', async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, { api: await seedApi() });
    const all = {};
    for (const name of ['record', 'dashboard', 'categories']) {
      await go(page, name);
      all[name] = await page.evaluate(() => {
        const out = [];
        for (const i of document.querySelectorAll('.icon')) if (i.getAttribute('aria-hidden') !== 'true') out.push(`icon not hidden: ${i.className}`);
        for (const b of document.querySelectorAll('button, a[href]')) {
          if (b.closest('[hidden]')) continue;
          const text = [...b.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains('icon'))).map((n) => n.textContent).join('').trim();
          if (!text && !(b.getAttribute('aria-label') || '').trim()) out.push(`no name: ${b.tagName}#${b.id}.${b.className}`);
        }
        return out;
      });
    }
    expect(all).toEqual({ record: [], dashboard: [], categories: [] });
    // 아이콘만 있는 버튼이 실제로 존재하는지(검사가 의미 있음): ← 뒤로, 월 이동
    await go(page, 'categories');
    await expect(page.locator('#catm-back')).toHaveAttribute('aria-label', '뒤로');
    await ctx.close();
  });

  for (const scheme of SCHEMES) {
    test(`C-D17 [${scheme}] 입력 오류: aria-invalid + aria-describedby 가 오류 문구, ⚠ 아이콘(장식) 표시, 오류 색`, async ({ browser }, testInfo) => {
      const { api } = await createLoggedInUser('der');
      const { ctx, page } = await open(browser, testInfo, { api, scheme });
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      await page.locator('#save-btn').click({ force: true });
      await expect(page.locator('#amount-error')).not.toHaveText('');
      const r = await page.evaluate(() => {
        const a = document.getElementById('amount');
        const err = document.getElementById('amount-error');
        const ids = (a.getAttribute('aria-describedby') || '').split(/\s+/);
        const before = getComputedStyle(err, '::before');
        return {
          invalid: a.getAttribute('aria-invalid'), describes: ids.includes('amount-error'), color: getComputedStyle(err).color,
          content: before.content, mask: before.webkitMaskImage || before.maskImage, w: before.width, bw: getComputedStyle(a.closest('.amount-wrap')).borderBottomColor,
        };
      });
      expect(r.invalid).toBe('true');
      expect(r.describes).toBe(true);
      expect(r.color).toBe(PAL(scheme).error);
      expect(r.mask).toMatch(/alert\.svg/);
      expect(r.content).not.toBe('none');
      expect(r.w).toBe('16px');
      expect(r.bw).toBe(PAL(scheme).error);
      // 장식 아이콘은 가상 요소라 접근성 트리에 이름으로 읽히지 않아야 한다: 오류 문구 textContent 에 ⚠ 문자가 없다
      expect(await page.locator('#amount-error').textContent()).not.toContain('⚠');
      // 메모 오류도 같은 구조인지 (51자)
      await page.locator('#memo').evaluate((e) => { e.removeAttribute('maxlength'); });
      await page.locator('#memo').fill('가'.repeat(51));
      await page.locator('#amount').fill('1000');
      await page.locator('#save-btn').click();
      await expect(page.locator('#memo-error')).not.toHaveText('');
      expect(await page.locator('#memo').getAttribute('aria-invalid')).toBe('true');
      expect(await page.locator('#memo').getAttribute('aria-describedby')).toContain('memo-error');
      await ctx.close();
    });

    test(`C-D18 [${scheme}] 하단 탭바 2칸, 활성 탭 primary 배경·inverse 글자·aria-current, 카테고리 관리에서는 대시보드 활성`, async ({ browser }, testInfo) => {
      const { api } = await createLoggedInUser('dtb');
      const { ctx, page } = await open(browser, testInfo, { api, scheme });
      await expect(page.locator('#category-chips button').first()).toBeVisible();
      await expect(page.locator('.tabbar .tabbar__item')).toHaveCount(2);
      const col = (id) => page.locator(id).evaluate((e) => { const cs = getComputedStyle(e); return { cur: e.getAttribute('aria-current'), bg: cs.backgroundColor, color: cs.color }; });
      const tok = await page.evaluate(() => { const t = document.createElement('i'); document.body.appendChild(t); const out = {}; for (const k of ['primary', 'text-inverse']) { t.style.color = `var(--color-${k})`; out[k] = getComputedStyle(t).color; } t.remove(); return out; });
      let rec = await col('#tab-record');
      let dash = await col('#tab-dashboard');
      expect(rec).toMatchObject({ cur: 'page', bg: tok.primary, color: tok['text-inverse'] });
      expect(dash.cur).toBeNull();
      expect(dash.bg).not.toBe(tok.primary);
      await page.locator('#tab-dashboard').click();
      await SCREENS.dashboard.ready(page).catch(() => {});
      rec = await col('#tab-record'); dash = await col('#tab-dashboard');
      expect(dash).toMatchObject({ cur: 'page', bg: tok.primary, color: tok['text-inverse'] });
      expect(rec.cur).toBeNull();
      await page.evaluate(() => { location.hash = '#categories'; });
      await expect(page.locator('#panel-categories')).toBeVisible();
      rec = await col('#tab-record'); dash = await col('#tab-dashboard');
      expect(dash).toMatchObject({ cur: 'page', bg: tok.primary, color: tok['text-inverse'] });
      expect(rec.cur).toBeNull();
      await ctx.close();
    });
  }

  test('C-D19 세 화면(카테고리 30개·15자 이름, 시드 데이터) 가로 스크롤 없음, 768px 본문 폭 480 이하·가운데 정렬', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const w = widthOf(testInfo);
    const { api } = await createLoggedInUser('dw');
    const longNames = Array.from({ length: 22 }, (_, i) => `${'긴이름가나다라마바사'}${String(i).padStart(2, '0')}`.slice(0, 15));
    for (const n of longNames) { const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: n }); expect(r.status()).toBe(201); }
    for (const [i, n] of longNames.entries()) await addTx(api, { category: n, amount: 10000 + i * 777, memo: '메모가 아주 길게 이어지는 경우 줄임표로 처리되는지 확인합니다', date: '2026-10-05' });
    await addTx(api, { type: 'income', category: '급여', amount: 123456789 > 100000000 ? 100000000 : 1, date: '2026-10-01' });
    const { ctx, page } = await open(browser, testInfo, { api });
    for (const name of ['record', 'dashboard', 'categories']) {
      await page.evaluate((h) => { location.hash = h; }, SCREENS[name].hash);
      await page.waitForTimeout(500);
      await expectNoHorizontalScroll(page, w);
      const box = await page.locator('main.app-main').boundingBox();
      if (w >= 768) {
        expect(box.width, `${name} 본문 폭`).toBeLessThanOrEqual(480.5);
        expect(Math.abs(box.x + box.width / 2 - w / 2), `${name} 가운데 정렬`).toBeLessThanOrEqual(1.5);
      }
    }
    await page.evaluate(() => { location.hash = '#dashboard'; });
    await expect(page.locator('#chart-monthly svg.chart-svg')).toBeVisible();
    await page.locator('#range-12').click();
    await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
    await expectNoHorizontalScroll(page, w);
    await ctx.close();
  });
});

// ================================================================== 11.4 기록
test.describe('11.4 기록', () => {
  test('C-D20 배치 순서(화면 정리): 제목 줄 날짜, 요약 카드 1장(남은 돈 + 수입|지출), 폼, 목록, 인사이트는 기록 화면에 없음', async ({ browser }, testInfo) => {
    test.skip(!(SEED_EMAIL && SEED_PASSWORD), 'SEED_* 필요');
    const { ctx, page } = await open(browser, testInfo, { api: await seedApi() });
    await SCREENS.record.ready(page);
    const tops = await page.evaluate(() => {
      const y = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().top + scrollY : null; };
      return { caption: y('#today-caption'), h1: y('#panel-record h1'), totals: y('#month-totals'), form: y('#tx-form'), quick: y('#quick-section:not([hidden])'), list: y('#tx-list'), insights: document.querySelector('#panel-record #insights') ? 1 : 0 };
    });
    expect(Math.abs(tops.caption - tops.h1), '날짜가 제목과 같은 줄').toBeLessThanOrEqual(12);
    expect(tops.h1).toBeLessThan(tops.totals);
    expect(tops.totals).toBeLessThan(tops.form);
    if (tops.quick !== null) { expect(tops.form).toBeLessThan(tops.quick); expect(tops.quick).toBeLessThan(tops.list); } else expect(tops.form).toBeLessThan(tops.list);
    expect(tops.insights, '인사이트는 대시보드로 옮겨졌다').toBe(0);
    test.info().annotations.push({ type: 'quick-visible', description: String(tops.quick !== null) });
    expect((await page.locator('#today-caption').textContent()).trim()).toMatch(/10월|19/);
    const parts = await page.locator('#month-totals').evaluate((c) => ({ bal: !!c.querySelector('.sum-balance'), cols: [...c.querySelectorAll('.sum-col')].map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }), divider: !!c.querySelector('.sum-divider') }));
    expect(parts.bal).toBe(true);
    expect(parts.divider).toBe(true);
    expect(parts.cols).toHaveLength(2);
    expect(Math.abs(parts.cols[0].w - parts.cols[1].w)).toBeLessThanOrEqual(1);
    await ctx.close();
  });

  test('C-D21 빠른 금액: +1만 → 10,000, +1천 → 11,000, +5만 → 61,000, 1억 초과 방지+오류, 포커스 유지', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dqa');
    const { ctx, page } = await open(browser, testInfo, { api });
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    const add = (n) => page.locator(`.quick-amounts [data-add="${n}"]`);
    const names = await page.locator('.quick-amounts button').allTextContents();
    expect(names).toEqual(['+1천', '+1만', '+5만']);
    await add(10000).click();
    await expect(page.locator('#amount')).toHaveValue('10,000');
    expect(await page.evaluate(() => document.activeElement && document.activeElement !== document.body)).toBe(true);
    await add(1000).click();
    await expect(page.locator('#amount')).toHaveValue('11,000');
    await add(50000).click();
    await expect(page.locator('#amount')).toHaveValue('61,000');
    await expect(page.locator('#amount-error')).toHaveText('');
    await expect(page.locator('#save-btn')).toHaveText('지출 저장 · 61,000원');
    // 상한
    await page.locator('#amount').fill('99990000');
    await add(10000).click();
    await expect(page.locator('#amount')).toHaveValue('100,000,000');
    await add(1000).click();
    await expect(page.locator('#amount')).toHaveValue('100,000,000');
    await expect(page.locator('#amount-error')).toBeVisible();
    await expect(page.locator('#amount-error')).toHaveText(/1억원 이하/);
    await add(50000).click();
    await expect(page.locator('#amount')).toHaveValue('100,000,000');
    expect(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), '칩 클릭 후 포커스').toBe(true);
    // 키보드(Space/Enter)로도 동작
    await page.locator('#amount').fill('');
    await add(1000).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#amount')).toHaveValue('1,000');
    await page.keyboard.press('Space');
    await expect(page.locator('#amount')).toHaveValue('2,000');
    await ctx.close();
  });

  test('C-D22 저장 버튼 라벨(지출/수입/수정), 금액 없으면 aria-disabled 모양+눌러도 금액 오류·POST 0, 칩 직후 Enter 도 동일', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dsv');
    await addTx(api, { memo: '수정대상', amount: 4000, category: '식비', date: FIXED_TODAY });
    const { ctx, page } = await open(browser, testInfo, { api });
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    let posts = 0;
    await page.route('**/api/transactions', (r) => { if (r.request().method() === 'POST') posts += 1; return r.continue(); });
    const save = page.locator('#save-btn');
    await expect(save).toHaveText('지출 저장');
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    const dis = await save.evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, color: cs.color, cursor: cs.cursor, disabledProp: e.disabled }; });
    expect(dis.disabledProp, '네이티브 disabled 가 아님(눌러서 오류를 보여 줘야 함)').toBe(false);
    await page.locator('#amount').fill('12500');
    await expect(save).toHaveText('지출 저장 · 12,500원');
    await expect(save).toHaveAttribute('aria-disabled', 'false');
    await page.waitForTimeout(350); // 배경색 전환 종료 대기
    const en = await save.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(en, '활성/비활성 모양이 같으면 안 됨').not.toBe(dis.bg);
    await page.locator('#type-income').click();
    await expect(save).toHaveText('수입 저장 · 12,500원');
    await page.locator('#type-expense').click();
    await page.locator('#amount').fill('');
    await expect(save).toHaveText('지출 저장');
    await save.click({ force: true });
    await expect(page.locator('#amount-error')).toHaveText('금액은 1원 이상 1억원 이하의 숫자로 입력해 주세요');
    expect(posts).toBe(0);
    // 칩 직후 Enter
    await page.locator('#category-chips button', { hasText: '교통' }).click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#amount-error')).toHaveText(/1억원 이하/);
    await page.waitForTimeout(400);
    expect(posts).toBe(0);
    // 수정 모드
    await page.locator('.tx-edit').first().click();
    await expect(save).toHaveText('수정 저장 · 4,000원');
    await page.locator('#amount').fill('4500');
    await expect(save).toHaveText('수정 저장 · 4,500원');
    await page.locator('#amount').fill('');
    await expect(save).toHaveText('수정 저장');
    await ctx.close();
  });

  test('C-D23 새 기록 저장 후 금액·메모 비고 유형·카테고리 유지, 토스트 "저장했어요"; 수정 저장·수정 취소 후 카테고리 해제', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dsk');
    await addTx(api, { memo: '수정대상', amount: 4000, category: '식비', date: FIXED_TODAY });
    const { ctx, page } = await open(browser, testInfo, { api });
    await expect(page.locator('#category-chips button').first()).toBeVisible();
    await page.locator('#type-income').click();
    await page.locator('#amount').fill('50000');
    await page.locator('#memo').fill('용돈받음');
    await page.locator('#category-chips button', { hasText: '용돈' }).click();
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('저장했어요');
    await expect(page.locator('#flash')).toBeVisible();
    await expect(page.locator('#amount')).toHaveValue('');
    await expect(page.locator('#memo')).toHaveValue('');
    await expect(page.locator('#type-income')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#category-chips button', { hasText: '용돈' })).toHaveAttribute('aria-pressed', 'true');
    // 연속 입력: 유지된 카테고리로 바로 저장 가능
    await page.locator('#amount').fill('1000');
    await page.locator('#save-btn').click();
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(3);
    // 수정 저장 후 해제
    await page.locator('#type-expense').click();
    await page.locator('.tx-edit', { hasText: '식비' }).click();
    await expect(page.locator('#category-chips button', { hasText: '식비' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#amount').fill('4100');
    await page.locator('#save-btn').click();
    await expect(page.locator('#flash')).toHaveText('수정했어요');
    expect(await page.locator('#category-chips button[aria-pressed="true"]').count(), '수정 저장 후 선택 해제').toBe(0);
    // 수정 취소 후 해제
    await page.locator('.tx-edit', { hasText: '식비' }).click();
    await expect(page.locator('#category-chips button[aria-pressed="true"]')).toHaveCount(1);
    await page.locator('#cancel-edit-btn').click();
    expect(await page.locator('#category-chips button[aria-pressed="true"]').count(), '수정 취소 후 선택 해제').toBe(0);
    await ctx.close();
  });

  test('C-D24 카테고리 격자(화면 정리): 4열, 8개 모두 견본 data-viz 1..8, 9개 이상은 7개 + 더 보기, 30개도 가로 스크롤 없음, Tab 으로 마지막 칸 가시, "편집 ›" 위치·동작', async ({ browser }, testInfo) => {
    const w = widthOf(testInfo);
    const { api } = await createLoggedInUser('dch');
    const { ctx, page } = await open(browser, testInfo, { api });
    await expect(page.locator('#category-chips button')).toHaveCount(8);
    const vizs = await page.locator('#category-chips button .swatch').evaluateAll((els) => els.map((e) => e.getAttribute('data-viz')));
    expect(vizs).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    const names = await page.locator('#category-chips button').allTextContents();
    expect(names).toEqual(['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타']);
    const g8 = await page.evaluate(() => { const ul = document.getElementById('category-chips'); const bs = [...ul.querySelectorAll('button')]; const lefts = new Set(bs.map((b) => Math.round(b.getBoundingClientRect().left))); const tops = new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))); return { cols: lefts.size, rows: tops.size, scrollable: ul.scrollWidth > ul.clientWidth + 1 }; });
    expect(g8).toEqual({ cols: 4, rows: 2, scrollable: false });
    // 편집 링크: 라벨 행 오른쪽
    const pos = await page.evaluate(() => { const l = document.getElementById('category-label').getBoundingClientRect(); const a = document.querySelector('.cat-edit-link').getBoundingClientRect(); return { sameRow: Math.abs((l.top + l.height / 2) - (a.top + a.height / 2)) < 12, right: a.left > l.right, fits: a.right <= document.documentElement.clientWidth, w: a.width, h: a.height }; });
    expect(pos).toMatchObject({ sameRow: true, right: true, fits: true });
    expect(pos.w).toBeGreaterThanOrEqual(43.5);
    expect(pos.h).toBeGreaterThanOrEqual(43.5);
    // 30개: 접힌 상태 7개 + 더 보기 (23)
    for (let i = 0; i < 22; i++) { const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: ('긴이름가나다라마바사' + String(i).padStart(2, '0')).slice(0, 15) }); expect(r.status()).toBe(201); }
    await page.reload();
    await expect(page.locator('#category-chips button')).toHaveCount(8);
    await expect(page.locator('#category-chips .chip--toggle')).toHaveText('더 보기 (23)');
    await expect(page.locator('#category-chips .chip--toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#category-chips .chip--toggle').click();
    await expect(page.locator('#category-chips button')).toHaveCount(31);
    await expect(page.locator('#category-chips .chip--toggle')).toHaveText('접기');
    await expectNoHorizontalScroll(page, w);
    const geo = await page.evaluate(() => {
      const ul = document.getElementById('category-chips');
      const bs = [...ul.querySelectorAll('button:not(.chip--toggle)')];
      return { rows: new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size, scrollable: ul.scrollWidth > ul.clientWidth + 1, vizs: [...ul.querySelectorAll('.swatch')].slice(0, 10).map((x) => x.getAttribute('data-viz')) };
    });
    expect(geo.rows).toBe(8);
    expect(geo.scrollable).toBe(false);
    expect(geo.vizs).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', 'none', 'none']);
    // 마지막 칸이 Tab 으로 닿고 보이는지
    await page.locator('#category-chips button').first().focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const last = await page.evaluate(() => { const b = document.activeElement; const r = b.getBoundingClientRect(); return { cls: b.className, text: b.textContent, inView: r.left >= 0 && r.right <= document.documentElement.clientWidth }; });
    expect(last.cls).toContain('chip--toggle');
    expect(last.inView, JSON.stringify(last)).toBe(true);
    await expectNoHorizontalScroll(page, w);
    await page.locator('a.cat-edit-link').click();
    await expect(page.locator('#panel-categories')).toBeVisible();
    await ctx.close();
  });

  test('C-D25 목록 행: 견본·카테고리·메모·부호 금액·배지, 행 높이 64 이상, 날짜 머리줄 합계 = 그날 행 합, 행 눌러 수정, 삭제 confirm', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('drw');
    await addTx(api, { category: '식비', memo: '점심', amount: 12500, date: FIXED_TODAY });
    await addTx(api, { category: '교통', memo: '', amount: 1500, date: FIXED_TODAY });
    await addTx(api, { type: 'income', category: '급여', memo: '월급', amount: 30000, date: FIXED_TODAY });
    await addTx(api, { category: '쇼핑', memo: '양말', amount: 7000, date: '2026-10-17' });
    const { ctx, page } = await open(browser, testInfo, { api });
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(4);
    const rows = await page.locator('#tx-list .tx-row').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect(); const ed = e.querySelector('.tx-edit').getBoundingClientRect();
      return { h: r.height, editH: ed.height, sw: !!e.querySelector('.swatch'), swSize: e.querySelector('.swatch').getBoundingClientRect().width, cat: e.querySelector('.tx-cat').textContent, memo: e.querySelector('.tx-memo')?.textContent || '', amt: e.querySelector('.tx-amount').textContent, badge: e.querySelector('.tx-kind').textContent.trim(), date: e.closest('.tx-group').querySelector('.list-head span').textContent, sum: e.closest('.tx-group').querySelector('.tx-day-sum').textContent };
    }));
    for (const r of rows) { expect(r.h).toBeGreaterThanOrEqual(64); expect(r.sw).toBe(true); expect(r.swSize).toBe(28); expect(r.badge).toMatch(/^(수입|지출)$/); }
    const today = rows.filter((r) => r.date.includes('오늘'));
    expect(today).toHaveLength(3);
    const parsed = (s) => Number(s.replace(/[^\d]/g, ''));
    const inc = today.filter((r) => r.badge === '수입').reduce((a, r) => a + parsed(r.amt), 0);
    const exp = today.filter((r) => r.badge === '지출').reduce((a, r) => a + parsed(r.amt), 0);
    expect(today[0].sum).toBe(`수입 +${inc.toLocaleString('en-US')}원 · 지출 −${exp.toLocaleString('en-US')}원`);
    const other = rows.find((r) => r.cat === '쇼핑');
    expect(other.sum).toBe('지출 −7,000원');
    // 행 누르면 수정 모드
    await page.locator('.tx-row', { hasText: '점심' }).locator('.tx-edit').click();
    await expect(page.locator('#save-btn')).toHaveText('수정 저장 · 12,500원');
    await expect(page.locator('#memo')).toHaveValue('점심');
    await page.locator('#cancel-edit-btn').click();
    // 삭제: confirm 취소 -> 유지, 확인 -> 삭제
    let msg = '';
    page.removeAllListeners('dialog');
    page.once('dialog', async (d) => { msg = d.message(); await d.dismiss(); });
    await page.locator('.tx-row', { hasText: '양말' }).locator('.tx-del').click();
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(4);
    expect(msg).toContain('삭제할까요');
    page.once('dialog', (d) => d.accept());
    await page.locator('.tx-row', { hasText: '양말' }).locator('.tx-del').click();
    await expect(page.locator('#flash')).toHaveText('삭제했어요');
    await expect(page.locator('#tx-list .tx-row')).toHaveCount(3);
    await ctx.close();
  });
});

// ================================================================== 11.5 대시보드
test.describe('11.5 대시보드', () => {
  test('C-D27/C-D28 요약 카드(화면 정리): 남은 돈 28px Newsreader, 수입|지출 두 열 같은 너비, 막대 없음, 음수 U+2212, 0/0 에서 NaN 없음, 보조 문구 muted', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dbl');
    await addTx(api, { type: 'income', category: '급여', amount: 900000, date: '2026-10-02' });
    await addTx(api, { category: '식비', amount: 400000, date: '2026-10-03' });
    await addTx(api, { type: 'income', category: '급여', amount: 1000000, date: '2026-09-02' });
    await addTx(api, { category: '식비', amount: 500000, date: '2026-09-03' });
    const { ctx, page } = await open(browser, testInfo, { api, hash: '#dashboard' });
    await expect(page.locator('#kpi .sum-balance, #kpi .sum-col')).toHaveCount(3);
    const measure = () => page.evaluate(() => {
      const val = document.querySelector('#kpi .sum-balance__value');
      const cols = [...document.querySelectorAll('#kpi .sum-col')];
      return {
        label: document.querySelector('#kpi .sum-balance__label').textContent.trim(), value: val.textContent, fs: getComputedStyle(val).fontSize, fam: getComputedStyle(val).fontFamily.split(',')[0].replace(/["']/g, '').trim(),
        cells: cols.map((p) => { const r = p.getBoundingClientRect(); const x = p.querySelector('.kpi-extra'); return { w: r.width, h: r.height, extra: x.textContent, extraColor: getComputedStyle(x).color }; }),
        bars: document.querySelectorAll('#kpi .bar-track, #kpi .bar-fill').length,
        muted: (() => { const t = document.createElement('i'); document.body.appendChild(t); t.style.color = 'var(--color-text-muted)'; const c = getComputedStyle(t).color; t.remove(); return c; })(),
        text: document.querySelector('#kpi').innerText,
      };
    });
    const m = await measure();
    expect(m.label).toBe('이번 달 남은 돈');
    expect(m.value).toBe('500,000원');
    expect(m.fs).toBe('28px');
    expect(m.fam).toBe('Newsreader');
    expect(m.bars, '수입·지출 막대는 없앴다(OQ-R4)').toBe(0);
    expect(m.cells).toHaveLength(2);
    expect(Math.abs(m.cells[0].w - m.cells[1].w)).toBeLessThanOrEqual(1);
    expect(m.cells[0].extra).toBe('▼ 지난달보다 수입이 10.0% 줄었어요');
    expect(m.cells[1].extra).toBe('▼ 지난달보다 지출이 20.0% 줄었어요');
    for (const c of m.cells) expect(c.extraColor, 'C-D28 보조 문구 muted').toBe(m.muted);
    expect(m.text).not.toMatch(/NaN|undefined|Infinity/);
    // 음수
    const neg = await createLoggedInUser('dng');
    await addTx(neg.api, { category: '식비', amount: 30000, date: '2026-10-03' });
    await addTx(neg.api, { type: 'income', category: '급여', amount: 10000, date: '2026-10-02' });
    const n = await open(browser, testInfo, { api: neg.api, hash: '#dashboard' });
    await expect(n.page.locator('#kpi .sum-balance, #kpi .sum-col')).toHaveCount(3);
    expect(await n.page.locator('#kpi .sum-balance__value').textContent()).toBe('−20,000원');
    await n.ctx.close();
    // 0 / 0
    const z = await createLoggedInUser('dz');
    const zz = await open(browser, testInfo, { api: z.api, hash: '#dashboard' });
    await expect(zz.page.locator('#kpi .sum-balance, #kpi .sum-col')).toHaveCount(3);
    expect(await zz.page.locator('#kpi').innerText()).not.toMatch(/NaN|undefined|Infinity/);
    expect(await zz.page.locator('#kpi .sum-balance__value').textContent()).toBe('0원');
    await zz.ctx.close();
    await ctx.close();
  });

  for (const scheme of SCHEMES) {
    test(`C-D29/C-D30/C-D31/C-D32 [${scheme}] 도넛 R92/r60·간격, 견본 번호 일치, 카드 제목 세그먼트, D3/D4 토큰 색, 표로 보기`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      const { api } = await createLoggedInUser('ddn');
      const cats = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'];
      for (const [i, c] of cats.entries()) await addTx(api, { category: c, amount: 80000 - i * 7000, date: '2026-10-05' });
      await addTx(api, { type: 'income', category: '급여', amount: 2000000, date: '2026-10-02' });
      await addTx(api, { type: 'income', category: '용돈', amount: 100000, date: '2026-10-03' });
      for (const [i, c] of cats.slice(0, 3).entries()) await addTx(api, { category: c, amount: 10000 + i * 1000, date: '2026-08-05' });
      const { ctx, page } = await open(browser, testInfo, { api, scheme });
      await expect(page.locator('#category-chips button')).toHaveCount(8);
      const chipViz = await page.locator('#category-chips button').evaluateAll((els) => Object.fromEntries(els.map((b) => [b.textContent, b.querySelector('.swatch').getAttribute('data-viz')])));
      const rowViz = await page.locator('#tx-list .tx-row').evaluateAll((els) => Object.fromEntries(els.filter((r) => r.querySelector('.tx-kind').textContent.includes('지출')).map((r) => [r.querySelector('.tx-cat').textContent, r.querySelector('.swatch').getAttribute('data-viz')])));
      for (const [k, v] of Object.entries(rowViz)) expect(v, `목록 견본 ${k}`).toBe(chipViz[k]);
      await go(page, 'dashboard');
      // 제목 줄에 세그먼트
      const head = await page.evaluate(() => { const t = document.getElementById('donut-title'); const s = document.getElementById('catview-income'); const h = t.closest('.card-head'); const a = t.getBoundingClientRect(); const b = s.getBoundingClientRect(); return { sameHead: !!h && h.contains(s), sameRow: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 16, title: t.textContent }; });
      expect(head).toMatchObject({ sameHead: true, title: '카테고리별 지출' }); // 화면 정리: 보기 전환 세그먼트는 제목 줄 아래 전체 너비(제목 줄 오른쪽은 표로 보기)
      // 도넛 기하: 바깥 92, 안쪽 60
      const geo = await page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => ({ d: p.getAttribute('d'), viz: p.getAttribute('data-viz'), stroke: getComputedStyle(p).stroke, sw: getComputedStyle(p).strokeWidth })));
      expect(geo).toHaveLength(8);
      const radii = new Set(geo.flatMap((g) => [...g.d.matchAll(/A\s*([\d.]+)[ ,]+([\d.]+)/g)].map((m) => Number(m[1]))));
      expect([...radii].sort((a, b) => a - b)).toEqual([60, 92]);
      const surface = await page.locator('#chart-donut').evaluate(() => { const c = document.querySelector('.donut-card'); return getComputedStyle(c).backgroundColor; });
      for (const g of geo) { expect(g.stroke, '조각 사이 간격 색 = 카드 배경').toBe(surface); expect(g.sw).toBe('2px'); }
      // 번호 일치: 칩 견본 == 도넛 조각 == 범례 견본
      const lg = await page.locator('#chart-donut .legend li').evaluateAll((els) => els.map((l) => ({ name: l.querySelector('.legend-label').textContent, viz: l.querySelector('.swatch').getAttribute('data-viz') })));
      expect(lg.map((l) => l.viz)).toEqual(geo.map((g) => g.viz));
      for (const l of lg) expect(l.viz, `범례 ${l.name}`).toBe(chipViz[l.name]);
      expect(new Set(geo.map((g) => g.viz)).size).toBe(8);
      // 표로 보기 (C-D32)
      const sm = await page.locator('#chart-donut details summary').boundingBox();
      expect(sm.height).toBeGreaterThanOrEqual(43.5);
      expect(sm.width).toBeGreaterThanOrEqual(43.5);
      await page.locator('#chart-donut details summary').click();
      await expect(page.locator('#chart-donut table')).toBeVisible();
      await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible(); // 표를 열어도 차트는 그대로
      const st = await (await get(api, '/api/stats/categories?from=2026-10&to=2026-10&type=expense')).json();
      const trs = await page.locator('#chart-donut table tbody tr').evaluateAll((els) => els.map((t) => [t.querySelector('th').textContent, t.querySelector('td').textContent]));
      expect(trs.map((r) => r[0])).toEqual(st.items.map((i) => i.category));
      expect(trs.map((r) => r[1])).toEqual(st.items.map((i) => `${i.total.toLocaleString('en-US')}원`));
      await expect(page.locator('#chart-donut table tfoot')).toContainText(`${st.grandTotal.toLocaleString('en-US')}원`);
      // 수입 보기 (C-D30)
      await page.locator('#catview-income').click();
      await expect(page.locator('#donut-title')).toHaveText('카테고리별 수입');
      await expect(page.locator('#chart-donut')).toHaveAttribute('aria-label', '카테고리 수입 비중');
      await expect(page.locator('#chart-donut figcaption')).toHaveText('카테고리 수입 비중');
      await expect(page.locator('#chart-donut svg text.chart-text-sub')).toHaveText('총 수입');
      await page.locator('#catview-expense').click();
      await expect(page.locator('#donut-title')).toHaveText('카테고리별 지출');
      // D3/D4 (C-D31)
      await page.locator('#range-12').click();
      await expect(page.locator('#chart-monthly table tbody tr')).toHaveCount(12);
      const d3 = await page.locator('#chart-monthly svg.chart-svg').evaluate((svg) => {
        const tok = (n) => { const t = document.createElement('i'); document.body.appendChild(t); t.style.color = `var(--color-${n})`; const c = getComputedStyle(t).color; t.remove(); return c; };
        const base = (cls) => getComputedStyle(svg.querySelector(`pattern rect.${cls}`)).fill;
        const r = svg.getBoundingClientRect();
        return { inc: base('chart-fill-income'), exp: base('chart-fill-expense'), tInc: tok('income'), tExp: tok('expense'), w: r.width, h: r.height, rects: svg.querySelectorAll(':scope > rect').length, legend: svg.closest('figure').querySelector('.legend').textContent };
      });
      expect(d3.inc).toBe(d3.tInc);
      expect(d3.exp).toBe(d3.tExp);
      expect(d3.w).toBeGreaterThan(200);
      expect(d3.rects).toBeGreaterThan(0);
      expect(d3.legend).toContain('수입 (/ 무늬)');
      expect(d3.legend).toContain('지출 (\\ 무늬)');
      const d4 = await page.locator('#chart-cat-trend svg.chart-svg').evaluate((svg) => svg.getBoundingClientRect().width);
      expect(d4).toBeGreaterThan(200);
      await page.locator('#cat-trend-chips button', { hasText: '교통' }).click();
      await expect(page.locator('#chart-cat-trend figcaption')).toHaveText('교통 월별 지출 추이');
      const trendViz = await page.locator('#chart-cat-trend .legend .swatch').getAttribute('data-viz');
      expect(trendViz).toBe(chipViz['교통']);
      await ctx.close();
    });
  }

  test('C-D29 "그 외 N개" 중립 단색 + 9개 이상 카테고리: 고정 번호 없는 카테고리는 목록 견본이 none, 도넛 조각은 서로 달라야 함', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dot');
    const extra = ['아홉째', '열째', '열한째'];
    for (const n of extra) { const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: n }); expect(r.status()).toBe(201); }
    const all = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타', ...extra];
    for (const [i, c] of all.entries()) await addTx(api, { category: c, amount: 90000 - i * 5000, date: '2026-10-05' });
    const { ctx, page } = await open(browser, testInfo, { api, hash: '#dashboard' });
    await expect(page.locator('#chart-donut svg.chart-svg')).toBeVisible();
    const geo = await page.locator('#chart-donut svg.chart-svg > path').evaluateAll((ps) => ps.map((p) => ({ viz: p.getAttribute('data-viz'), cls: p.getAttribute('class'), fill: p.getAttribute('fill') })));
    expect(geo).toHaveLength(8);
    expect(geo.at(-1).viz).toBe('other');
    expect(geo.at(-1).cls).toContain('viz-other');
    expect(geo.at(-1).fill).toBeNull(); // 무늬 없는 중립 단색
    expect(new Set(geo.map((g) => g.viz)).size).toBe(8);
    const label = (await page.locator('#chart-donut .legend-label').allTextContents()).at(-1);
    expect(label).toBe('그 외 4개');
    const sw = await page.locator('#chart-donut .legend li').last().locator('.swatch').getAttribute('data-viz');
    expect(sw).toBe('other');
    await ctx.close();
  });

  test('C-D33 ← 뒤로: 44x44 + 이름 "뒤로", 기록 "편집"→기록, 대시보드 "카테고리 관리"→대시보드, 직접 진입→대시보드', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dbk');
    // 기록에서
    let o = await open(browser, testInfo, { api });
    await expect(o.page.locator('#category-chips button').first()).toBeVisible();
    await o.page.locator('a.cat-edit-link').click();
    await expect(o.page.locator('#panel-categories')).toBeVisible();
    const box = await o.page.locator('#catm-back').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    await expect(o.page.getByRole('link', { name: '뒤로' })).toBeVisible();
    await o.page.locator('#catm-back').click();
    await expect(o.page.locator('#panel-record')).toBeVisible();
    // 대시보드에서
    await o.page.locator('#tab-dashboard').click();
    await expect(o.page.locator('#panel-dashboard')).toBeVisible();
    await o.page.locator('#panel-dashboard a[href="#categories"]').click();
    await expect(o.page.locator('#panel-categories')).toBeVisible();
    await o.page.locator('#catm-back').click();
    await expect(o.page.locator('#panel-dashboard')).toBeVisible();
    await o.ctx.close();
    // 직접 진입
    o = await open(browser, testInfo, { api, hash: '#categories' });
    await expect(o.page.locator('#catm-active .cat-row').first()).toBeVisible();
    await o.page.locator('#catm-back').click();
    await expect(o.page.locator('#panel-dashboard')).toBeVisible();
    await o.ctx.close();
  });
});

// ================================================================== 11.6 카테고리 관리
test.describe('11.6 카테고리 관리', () => {
  test('C-D34/C-D36 세그먼트 활성 개수(추가·사용 안 함·다시 사용 후 갱신), 크기 차 1px 이하, 한도 "N/30" + 30개면 추가 비활성 모양+이유', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('dsg2');
    const { ctx, page, ...rest } = await open(browser, testInfo, { api, hash: '#categories' });
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept());
    await expect(page.locator('#catm-active .cat-row').first()).toBeVisible();
    const seg = async () => ({ e: (await page.locator('#catm-expense').innerText()).replace(/\s+/g, ' ').trim(), i: (await page.locator('#catm-income').innerText()).replace(/\s+/g, ' ').trim() });
    expect(await seg()).toEqual({ e: '지출 8', i: '수입 4' });
    const a = await page.locator('#catm-expense').boundingBox();
    const b = await page.locator('#catm-income').boundingBox();
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    const limit = (await page.locator('#catm-limit').textContent()).trim();
    expect(limit).toMatch(/^8\/30/);
    await page.locator('#catm-name').fill('반려동물');
    await page.locator('#catm-add-btn').click();
    await expect(page.locator('#catm-status')).toContainText('추가했어요');
    expect((await seg()).e).toBe('지출 9');
    expect((await page.locator('#catm-limit').textContent()).trim()).toMatch(/^9\/30/);
    await page.getByRole('button', { name: '반려동물 사용 안 함' }).click();
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    expect((await seg()).e).toBe('지출 8');
    await page.locator('#catm-inactive-details summary').click();
    await page.locator('#catm-inactive').getByRole('button', { name: /다시 사용/ }).first().click();
    await expect.poll(async () => (await seg()).e).toBe('지출 9');
    // 30개 채우기
    for (let i = 0; i < 21; i++) { const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: `채움${i}` }); expect(r.status()).toBe(201); }
    await page.reload();
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(30);
    expect((await seg()).e).toBe('지출 30');
    expect((await page.locator('#catm-limit').textContent()).trim()).toMatch(/^30\/30/);
    const btn = await page.locator('#catm-add-btn').evaluate((e) => ({ aria: e.getAttribute('aria-disabled'), disabled: e.disabled, bg: getComputedStyle(e).backgroundColor, op: getComputedStyle(e).opacity }));
    const reason = (await page.locator('#catm-limit').textContent()).trim();
    test.info().annotations.push({ type: 'limit-30', description: `add btn=${JSON.stringify(btn)} text="${reason}"` });
    expect(btn.aria === 'true' || btn.disabled, `30개일 때 추가 버튼 비활성 모양 ${JSON.stringify(btn)}`).toBe(true);
    expect(reason).toMatch(/30\/30.*더 추가할 수 없어요/); // 서버 409(30개까지) 와 같은 뜻
    await page.locator('#catm-name').fill('서른하나');
    await page.locator('#catm-name').press('Enter'); // 비활성 모양 버튼은 force 클릭이 하단 탭바 좌표를 맞출 수 있어 Enter 로 제출한다
    await expect(page.locator('#catm-add-error')).toContainText('30개까지');
    void rest;
    await ctx.close();
  });

  test('C-D35/C-D37 행: 견본 28px(1~8번째 data-viz 1..8, 9번째부터 none), 이름·"기록 N건"·버튼 2개, 마지막 행 아래 구분선 없음; 사용 안 함이어도 다른 견본 번호 불변, 다시 사용하면 원래 번호', async ({ browser }, testInfo) => {
    const { api } = await createLoggedInUser('drow');
    for (let i = 0; i < 3; i++) { const r = await json(api, 'POST', '/api/categories', { type: 'expense', name: `추가${i}` }); expect(r.status()).toBe(201); }
    await addTx(api, { category: '교통', amount: 3000, date: '2026-10-05' });
    const { ctx, page } = await open(browser, testInfo, { api, hash: '#categories' });
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept());
    await expect(page.locator('#catm-active .cat-row')).toHaveCount(11);
    const rowsInfo = () => page.locator('#catm-active .cat-row').evaluateAll((els) => els.map((r) => { const s = r.querySelector('.swatch'); const bs = [...r.querySelectorAll('button')]; return { name: r.querySelector('.cat-name').textContent, viz: s.getAttribute('data-viz'), size: s.getBoundingClientRect().width, used: r.querySelector('.cat-used').textContent, btns: bs.map((b) => b.getAttribute('aria-label')), lastBorder: getComputedStyle(r.closest('li') || r).borderBottomWidth }; }));
    const before = await rowsInfo();
    expect(before.map((r) => r.viz)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', 'none', 'none', 'none']);
    for (const r of before) { expect(r.size).toBe(28); expect(r.used).toMatch(/^기록 \d+건$/); expect(r.btns).toEqual([`${r.name} 이름 바꾸기`, `${r.name} 사용 안 함`]); }
    expect(before.find((r) => r.name === '교통').used).toBe('기록 1건');
    const last = await page.locator('#catm-active > li').last().evaluate((li) => { const cs = getComputedStyle(li); return { b: cs.borderBottomWidth, bs: cs.borderBottomStyle, inner: li.querySelector('.cat-row') ? getComputedStyle(li.querySelector('.cat-row')).borderBottomWidth : null }; });
    const first = await page.locator('#catm-active > li').first().evaluate((li) => getComputedStyle(li).borderBottomWidth);
    test.info().annotations.push({ type: 'divider', description: `first=${first} last=${JSON.stringify(last)}` });
    expect(parseFloat(last.b), '마지막 행 아래 구분선').toBe(0);
    expect(parseFloat(first), '첫 행 아래 구분선은 있음').toBeGreaterThan(0);
    // 사용 안 함: 3번째('교통') 비활성 -> 나머지 번호 불변
    await page.getByRole('button', { name: '교통 사용 안 함' }).click();
    await expect(page.locator('#catm-inactive-title')).toHaveText('사용 안 함 (1)');
    const mid = await rowsInfo();
    const byName = (arr) => Object.fromEntries(arr.map((r) => [r.name, r.viz]));
    const bb = byName(before); const mm = byName(mid);
    for (const [k, v] of Object.entries(mm)) expect(v, `${k} 견본 번호 불변`).toBe(bb[k]);
    // 비활성 목록 견본은 원래 번호
    await page.locator('#catm-inactive-details summary').click();
    const inactiveViz = await page.locator('#catm-inactive .swatch').first().getAttribute('data-viz');
    expect(inactiveViz).toBe('3');
    // 기록 칩도 같은 번호표 (교통 칩은 사라지고 나머지 번호 불변)
    await page.locator('#catm-inactive').getByRole('button', { name: /다시 사용/ }).first().click();
    await expect.poll(async () => byName(await rowsInfo())).toEqual(bb);
    await ctx.close();
  });
});

// ================================================================== 스크린샷 (수동 확인용)
test.describe('스크린샷', () => {
  test.skip(!(SEED_EMAIL && SEED_PASSWORD && SHOTS), 'SEED_* 와 QA_SHOT_DIR 필요');
  for (const scheme of SCHEMES) {
    test(`shots [${scheme}]`, async ({ browser }, testInfo) => {
      test.setTimeout(90_000);
      mkdirSync(SHOTS, { recursive: true });
      const w = widthOf(testInfo);
      const { ctx, page } = await open(browser, testInfo, { api: await seedApi(), scheme });
      await SCREENS.record.ready(page);
      await page.screenshot({ path: join(SHOTS, `${w}-${scheme}-record-top.png`) });
      await page.screenshot({ path: join(SHOTS, `${w}-${scheme}-record-full.png`), fullPage: true });
      await page.locator('#amount').fill('12500');
      await page.locator('#category-chips button').nth(1).click();
      await page.locator('#save-btn').click({ trial: true }).catch(() => {});
      await page.screenshot({ path: join(SHOTS, `${w}-${scheme}-record-filled.png`) });
      await go(page, 'dashboard');
      await page.locator('#chart-donut details summary').click();
      await page.screenshot({ path: join(SHOTS, `${w}-${scheme}-dashboard-full.png`), fullPage: true });
      await go(page, 'categories');
      await page.screenshot({ path: join(SHOTS, `${w}-${scheme}-categories-full.png`), fullPage: true });
      await ctx.close();
    });
  }
});
