import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balanceRate } from '../public/js/lib/dashboard-data.js';
import { undoPlan, undoFailText, txBody } from '../public/js/lib/undo.js';

test('balanceRate: 남았어요 / 많아요 / 수입 없음 / 줄 없음', () => {
  assert.deepEqual(balanceRate(1000000, 325000), { direction: 'left', percent: 32.5, text: '수입의 32.5%가 남았어요' });
  assert.deepEqual(balanceRate(1000000, 0), { direction: 'left', percent: 0, text: '수입의 0.0%가 남았어요' });
  assert.equal(balanceRate(1000000, -200000).text, '지출이 수입보다 20.0% 많아요');
  assert.equal(balanceRate(1000000, -200000).direction, 'over');
  assert.equal(balanceRate(0, -5000).direction, 'none');
  assert.equal(balanceRate(0, -5000).text, '수입 기록이 없어 비율을 계산하지 않아요');
  assert.equal(balanceRate(0, 0), null);
});

test('balanceRate: 큰 비율, 소수 반올림 경계, NaN 없음', () => {
  assert.equal(balanceRate(1, -100000000).text, '지출이 수입보다 10,000,000,000.0% 많아요');
  assert.equal(balanceRate(1, -1234).text, '지출이 수입보다 123,400.0% 많아요');
  assert.equal(balanceRate(1000, 1000).text, '수입의 100.0%가 남았어요');
  assert.equal(balanceRate(2000, 1).text, '수입의 0.1%가 남았어요'); // 0.05 -> 0.1
  assert.equal(balanceRate(10000, 4).text, '수입의 0.0%가 남았어요'); // 0.04
  assert.equal(balanceRate(3, 1).text, '수입의 33.3%가 남았어요');
  for (const [i, b] of [[NaN, NaN], [undefined, undefined], [100, NaN]]) {
    const r = balanceRate(i, b);
    assert.ok(r === null || !/NaN|Infinity/.test(r.text));
  }
  assert.equal(Object.is(balanceRate(1000, 0).percent, -0), false);
});

const tx = { id: 7, type: 'expense', amount: 5000, category: '식비', memo: '점심', date: '2026-10-01' };

test('undoPlan: 생성은 DELETE', () => {
  assert.deepEqual(undoPlan('create', null, tx), { method: 'DELETE', id: 7, body: null, month: null });
});

test('undoPlan: 수정은 수정 전 전체 값으로 PUT, 달은 수정 전 날짜', () => {
  const before = { type: 'expense', amount: 4000, category: '식비', memo: '', date: '2026-09-30' };
  const after = { ...tx, amount: 5000, date: '2026-10-01' };
  assert.deepEqual(undoPlan('update', before, after), { method: 'PUT', id: 7, body: before, month: '2026-09' });
});

test('undoPlan: 사용 안 함 카테고리에서 (type, category) 를 바꿨으면 null, 안 바꿨으면 가능', () => {
  const before = { type: 'expense', amount: 4000, category: '쇼핑', memo: '', date: '2026-10-01' };
  assert.equal(undoPlan('update', before, { ...tx, category: '식비' }, true), null);
  assert.equal(undoPlan('update', before, { ...tx, type: 'income' }, true), null);
  assert.ok(undoPlan('update', before, { ...tx, category: '쇼핑', amount: 1 }, true));
  assert.ok(undoPlan('update', before, { ...tx, category: '식비' }, false));
});

test('undoPlan: 입력이 모자라면 null', () => {
  assert.equal(undoPlan('create', null, null), null);
  assert.equal(undoPlan('create', null, {}), null);
  assert.equal(undoPlan('update', null, tx), null);
  assert.equal(undoPlan('delete', null, tx), null);
});

test('txBody / undoFailText', () => {
  assert.deepEqual(txBody({ ...tx, extra: 1, memo: null }), { type: 'expense', amount: 5000, category: '식비', memo: '', date: '2026-10-01' });
  assert.equal(undoFailText({ status: 404 }), '이미 삭제된 기록이라 되돌리지 못했어요');
  assert.equal(undoFailText({ status: 500 }), '되돌리지 못했어요. 목록에서 직접 고쳐 주세요.');
  assert.equal(undoFailText(new Error('x')), '되돌리지 못했어요. 목록에서 직접 고쳐 주세요.');
});

test('HTML: #flash 는 글자 전용, 버튼은 형제 #flash-undo (live 영역 밖)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="toast" id="toast">\s*<p id="flash" role="status" aria-live="polite"><\/p>\s*<button type="button"[^>]*id="flash-undo" hidden>되돌리기<\/button>/);
});

test('입력 초기화: 버튼 마크업(접근 이름, 기본 숨김)과 SVG(메타데이터 없음)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" class="reset-btn" id="reset-btn" aria-label="입력 초기화" hidden>/);
  const svg = readFileSync(new URL('../public/icons/reset.svg', import.meta.url), 'utf8');
  assert.match(svg, /^<svg /);
  assert.match(svg, /stroke-width="1.8"/);
  assert.doesNotMatch(svg, /metadata|c2pa|data:|https?:\/\/(?!www\.w3\.org)/);
});

test('다크 토큰: 선 토큰이 금색 계열이고 두 다크 블록이 같은 값, 포커스 색은 그대로', () => {
  const css = readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#C9A55C/);
  assert.equal(css.split('--color-field-line-active: var(--color-focus)').length - 1, 3); // 라이트 + 다크 2곳
  for (const v of ['#4B4231', '#9A7E4A']) assert.equal(css.split(v).length - 1 >= 2, true, v);
  assert.equal(css.split('--color-focus:          #7DB6FE').length - 1, 1);
  assert.match(css, /--color-focus: *#0658AB/);
  assert.doesNotMatch(css, /#33312C/);
});

test('shouldShowReset: 금액·메모·종류·날짜 변경 때만, 카테고리·수정 모드는 제외', async () => {
  const { shouldShowReset } = await import('../public/js/lib/reset.js');
  const base = { editing: false, amount: '', memo: '', type: 'expense', date: '2026-10-23', today: '2026-10-23' };
  assert.equal(shouldShowReset(base), false); // 저장 직후(카테고리만 유지)
  assert.equal(shouldShowReset({ ...base, amount: '1,000' }), true);
  assert.equal(shouldShowReset({ ...base, memo: '점심' }), true);
  assert.equal(shouldShowReset({ ...base, type: 'income' }), true);
  assert.equal(shouldShowReset({ ...base, date: '2026-10-01' }), true);
  assert.equal(shouldShowReset({ ...base, amount: '1', editing: true }), false);
});
