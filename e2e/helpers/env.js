export const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const ORIGIN = new URL(BASE_URL).origin;
export const IS_HTTPS = BASE_URL.startsWith('https://');
// 시드 검증(C26, C62)용. 시드 스크립트를 돌린 환경에서만 지정.
export const SEED_EMAIL = process.env.SEED_EMAIL || '';
export const SEED_PASSWORD = process.env.SEED_PASSWORD || '';
export const SEED_TODAY = process.env.SEED_TODAY || ''; // YYYY-MM-DD
// 로컬에서 TRUST_PROXY=true 로 띄웠을 때만 IP 제한(C41) 테스트 실행
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
// SIGNUP_ENABLED=false 로 띄운 별도 서버에서만 C37 일부 실행
export const SIGNUP_CLOSED = process.env.SIGNUP_ENABLED === 'false';
