// UX 묶음 1 (plan-ux1): 새 순수 함수와 정적 구성
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { isTouchType } from '../public/js/lib/input-mode.js';
import { undoPlan, undoFailText } from '../public/js/lib/undo.js';
import { shiftDay, dateSummaryLabel, dayLabel } from '../public/js/lib/date.js';
import { dashErrorText } from '../public/js/lib/dashboard-data.js';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('isTouchType: touch·pen 만 터치 모드', () => {
  assert.equal(isTouchType('touch'), true);
  assert.equal(isTouchType('pen'), true);
  assert.equal(isTouchType('mouse'), false);
  assert.equal(isTouchType(''), false);
  assert.equal(isTouchType(undefined), false);
});

test('undoPlan delete: 지운 거래를 POST 로 다시 만든다 (그 달 표시)', () => {
  const tx = { id: 7, type: 'expense', amount: 4500, category: '식비', memo: null, date: '2026-02-28', createdAt: 'x' };
  assert.deepEqual(undoPlan('delete', tx, null), {
    method: 'POST', id: null, body: { type: 'expense', amount: 4500, category: '식비', memo: '', date: '2026-02-28' }, month: '2026-02',
  });
  assert.equal(undoPlan('delete', null, null), null);
  assert.equal(undoPlan('delete', { type: 'income' }, null), null);
  // 기존 종류는 그대로
  assert.equal(undoPlan('create', null, null), null);
  assert.equal(undoPlan('create', null, { id: 3 }).method, 'DELETE');
  assert.match(undoFailText({ status: 400 }), /직접 고쳐/);
  assert.equal(undoFailText({ status: 400 }, 'POST'), '되살리지 못했어요. 다시 입력해 주세요'); // 삭제 되돌리기 실패
  assert.equal(undoFailText({ status: 500 }, 'POST'), '되살리지 못했어요. 다시 입력해 주세요');
  assert.match(undoFailText({ status: 400 }, 'PUT'), /직접 고쳐/);
});

test('shiftDay: 월·연 경계와 잘못된 입력', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-11-17', 0), '2026-11-17');
  assert.equal(shiftDay('2026-02-30', -1), null);
  assert.equal(shiftDay('nope', -1), null);
  assert.equal(shiftDay('2026-11-17', 1.5), null);
});

test('dateSummaryLabel: 오늘·어제·그 밖, 목록 머리줄 dayLabel 은 그대로', () => {
  assert.equal(dateSummaryLabel('2026-11-17', '2026-11-17'), '오늘');
  assert.equal(dateSummaryLabel('2026-11-16', '2026-11-17'), '어제');
  assert.equal(dateSummaryLabel('2026-02-28', '2026-03-01'), '어제');
  assert.equal(dateSummaryLabel('2025-12-31', '2026-01-01'), '어제');
  assert.equal(dateSummaryLabel('2026-11-14', '2026-11-17'), '11월 14일 (토)');
  assert.equal(dateSummaryLabel('bad', '2026-11-17'), '');
  assert.equal(dayLabel('2026-11-16', '2026-11-17'), '11월 16일 (월)'); // 어제도 머리줄은 날짜 형식
});

test('dashErrorText: 0개 빈 문구, 1개 그대로, 2개 이상 접두 + 첫 문구', () => {
  assert.equal(dashErrorText([]), '');
  assert.equal(dashErrorText(undefined), '');
  assert.equal(dashErrorText(['서버 오류']), '서버 오류');
  assert.equal(dashErrorText(['A', 'B']), '일부 내용을 불러오지 못했어요. A');
});

test('정적: manifest.json 과 앱 아이콘 PNG, head 태그', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.name, '가계부');
  assert.deepEqual(m.icons.map((i) => i.purpose).sort(), ['any', 'any', 'maskable']);
  for (const i of m.icons) {
    const file = new URL(`../public/${i.src}`, import.meta.url);
    assert.ok(existsSync(file), i.src);
    const buf = readFileSync(file);
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)]; // PNG IHDR
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  const apple = readFileSync(new URL('../public/app-icons/apple-touch-icon-180.png', import.meta.url));
  assert.equal(apple.readUInt32BE(16), 180);
  for (const f of ['index.html', 'login.html']) {
    const html = read(f);
    assert.match(html, /<link rel="manifest" href="manifest\.json">/, f);
    assert.match(html, /<link rel="apple-touch-icon" href="app-icons\/apple-touch-icon-180\.png">/, f);
    assert.match(html, /<meta name="theme-color" content="#[0-9A-Fa-f]{6}">/, f);
    assert.ok(html.indexOf('name="theme-color"') < html.indexOf('theme-init.js'), `${f}: theme-color meta 가 theme-init 보다 앞`);
  }
  assert.equal(readdirSync(new URL('../public/icons/', import.meta.url)).length, 19); // 기존 아이콘 폴더는 그대로
});

test('정적: 날짜 빠른 선택, 월 카테고리 details, 다시 시도 버튼', () => {
  const html = read('index.html');
  assert.match(html, /role="group" aria-label="날짜 빠른 선택"/);
  assert.match(html, /id="date-today"[^>]*aria-pressed="true"[^>]*>오늘</);
  assert.match(html, /id="date-yesterday"[^>]*aria-pressed="false"[^>]*>어제</);
  assert.match(html, /<details class="month-cats" id="month-cats">\s*<summary>[^<]+<\/summary>\s*<div id="month-summary">/);
  assert.doesNotMatch(html.match(/<details class="month-cats"[^>]*>/)[0], /\bopen\b/);
  assert.match(html, /id="month-retry" hidden>/);
  assert.match(html, /id="dash-retry" hidden>/);
});

test('정적: 이메일 값은 말줄임 없이 줄바꿈', () => {
  const css = read('css/style.css');
  const rule = css.match(/\.account-row__value \{[^}]*\}/)[0];
  assert.match(rule, /white-space: normal/);
  assert.match(rule, /overflow-wrap: anywhere/);
  assert.doesNotMatch(rule, /ellipsis/);
});

test('정적: record.js 는 localStorage 를 try/catch 로 쓰고 element.animate 를 쓰지 않는다', () => {
  const js = read('js/record.js');
  assert.match(js, /try \{ if \(window\.localStorage\.getItem\(CATS_KEY\)/);
  assert.doesNotMatch(js, /\.animate\(/);
});
