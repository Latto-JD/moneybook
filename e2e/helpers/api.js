import { request as pwRequest } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BASE_URL, TRUST_PROXY } from './env.js';

// 서버가 TRUST_PROXY=true 로 떠 있으면(그리고 테스트도 TRUST_PROXY=true 로 실행하면) 컨텍스트마다 고유 IP 를 보낸다.
// 그렇지 않으면 모든 테스트가 127.0.0.1 하나로 보여 '같은 IP 가입 10회/시간' 제한(정상 동작)에 걸린다.
let ipSeq = 0;
const ipBase = Math.floor(Math.random() * 250) + 1; // 프로세스마다 무작위: 이전 실행의 시도 기록(1시간 유지)과 겹치지 않게
const ipMid = Math.floor(Math.random() * 250);
export function uniqueIp() {
  ipSeq += 1;
  return `10.${ipBase}.${(ipMid + Math.floor(ipSeq / 250)) % 250}.${(ipSeq % 250) + 1}`;
}
import { newAccount, DEFAULT_NAME } from './accounts.js';

/**
 * API 컨텍스트 생성. 쿠키는 컨텍스트가 보관한다.
 * withOrigin=false 면 Origin 헤더를 붙이지 않는다(CSRF 테스트용).
 * 계약 TODO: Origin 은 BASE_URL 출처와 같은 값(plan 4.4 CSRF).
 */
export async function newApi({ withOrigin = true, storageState, extraHeaders = {}, baseURL = BASE_URL } = {}) {
  return pwRequest.newContext({
    baseURL,
    storageState,
    extraHTTPHeaders: {
      ...(withOrigin ? { Origin: new URL(baseURL).origin } : {}),
      ...(TRUST_PROXY && !Object.keys(extraHeaders).some((k) => k.toLowerCase() === 'x-forwarded-for') ? { 'x-forwarded-for': uniqueIp() } : {}),
      ...extraHeaders,
    },
  });
}

/** JSON POST/PUT 헬퍼 (Content-Type: application/json 명시) */
export function json(api, method, url, body, opts = {}) {
  return api.fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    data: body === undefined ? undefined : JSON.stringify(body),
    failOnStatusCode: false,
  });
}

export const get = (api, url, opts = {}) => api.get(url, { failOnStatusCode: false, ...opts });

/** 가입 (자동 로그인, 쿠키가 api 컨텍스트에 저장됨). */
export async function signup(api, { email, password, name = DEFAULT_NAME }, headers) {
  return json(api, 'POST', '/api/auth/signup', { email, password, name }, { headers });
}

export async function login(api, { email, password }, headers) {
  return json(api, 'POST', '/api/auth/login', { email, password }, { headers });
}

/** 신규 계정을 만들고 로그인된 api 컨텍스트를 반환. */
export async function createLoggedInUser(tag = '', { baseURL } = {}) {
  const account = newAccount(tag);
  const api = await newApi({ baseURL });
  const res = await signup(api, account);
  if (res.status() !== 201) {
    throw new Error(`signup failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return { api, account, user: body.user };
}

/** 로그인 상태를 파일로 저장 (UI 테스트에서 storageState 로 재사용). */
export async function saveState(api, path) {
  mkdirSync(dirname(path), { recursive: true });
  await api.storageState({ path });
  return path;
}

/** Set-Cookie 헤더 원문(여러 개면 줄바꿈 결합) */
export function setCookieHeader(res) {
  return res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
}

/** 거래 생성 헬퍼 */
export function addTx(api, tx) {
  return json(api, 'POST', '/api/transactions', {
    type: 'expense', amount: 1000, category: '식비', memo: '', date: '2026-10-01', ...tx,
  });
}
