// 금액 파싱/포맷 (원화 정수만)
export const MAX_AMOUNT = 100000000;

/** "12,500", "12500원" 등을 정수로. 무효면 null (0, 음수, 소수, 범위 초과 포함). */
export function parseAmount(input) {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input >= 1 && input <= MAX_AMOUNT ? input : null;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/원$/, '').trim();
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_AMOUNT) return null;
  return n;
}

/** 12500 -> "12,500". 정수가 아니면 "0". */
export function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const v = Math.round(n);
  const sign = v < 0 ? '-' : '';
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 12500 -> "12,500원" */
export function formatWon(n) {
  return formatNumber(n) + '원';
}

/** 입력 중 실시간 콤마: "12a500" -> "12,500", 숫자 없으면 "". 선행 0 제거. */
export function formatAmountInput(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits === '') return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 빠른 금액 칩: 입력칸의 현재 값에 delta 를 더한다. 상한(MAX_AMOUNT)을 넘으면 상한에서 멈추고 capped=true.
 * 입력이 비었거나 숫자가 없으면 0 에서 시작한다.
 */
export function addToAmount(input, delta) {
  const cur = Number(String(input ?? '').replace(/\D/g, '')) || 0;
  const sum = cur + delta;
  return sum > MAX_AMOUNT ? { value: MAX_AMOUNT, capped: true } : { value: sum, capped: false };
}

/** 부호 붙은 금액: 수입 "+12,500원", 지출 "−12,500원" (U+2212). 기호 외에 색·배지·라벨로도 구분한다. */
export function formatSignedWon(type, n) {
  return (type === 'income' ? '+' : '−') + formatWon(Math.abs(n));
}

/** 남은 돈(잔액): 음수면 앞에 U+2212. "-" 대신 같은 폭의 마이너스 기호를 쓴다. */
export function formatBalanceWon(n) {
  return n < 0 ? `−${formatWon(Math.abs(n))}` : formatWon(n);
}
