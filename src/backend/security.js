import { ApiError } from './http.js';

const UNSAFE = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function isStateChanging(method) {
  return UNSAFE.has(method);
}

function firstValue(v) {
  return String(v ?? '').split(',')[0].trim().toLowerCase();
}

// CSRF: 상태 변경 요청은 Origin 이 필수이며 요청 호스트 또는 APP_ORIGINS 와 일치해야 한다.
export function checkOrigin(req, config) {
  const reject = () => new ApiError(403, 'CSRF_REJECTED', '허용되지 않은 출처의 요청이에요.');
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') throw reject();
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw reject();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw reject();
  const host = firstValue(req.headers['x-forwarded-host'] || req.headers.host);
  if (host && parsed.host.toLowerCase() === host) return;
  if (config.appOrigins.includes(parsed.origin)) return;
  throw reject();
}

export function clientIp(req, config) {
  let ip = '';
  if (config.trustProxy) ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  if (!ip) ip = req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '').slice(0, 64) || 'unknown';
}
