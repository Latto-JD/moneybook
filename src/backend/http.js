import { MAX_BODY_BYTES } from './config.js';

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra; // fields, headers
  }
}

export const CSP =
  "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

export function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

export function sendResult(res, { status = 200, body, headers = {} }) {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (status === 204 || body === undefined) {
    res.statusCode = status;
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

export function errorResult(err) {
  const error = { code: err.code, message: err.message };
  if (err.extra?.fields) error.fields = err.extra.fields;
  return { status: err.status, body: { error }, headers: err.extra?.headers || {} };
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function hasBody(req) {
  const len = req.headers['content-length'];
  if (req.headers['transfer-encoding']) return true;
  return len !== undefined && Number(len) > 0;
}

function isJsonContentType(ct) {
  if (!ct) return false;
  const base = String(ct).split(';')[0].trim().toLowerCase();
  return base === 'application/json';
}

const tooLarge = () =>
  new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 커요.', { headers: { Connection: 'close' } });

function readStream(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

// JSON 본문 읽기. 본문이 없으면 {}. req.body(호스팅 환경의 자동 파싱)는 건드리지 않고 스트림을 직접 읽는다.
// 스트림이 이미 소비된 환경(자동 파싱)에서는 req.body 를 폴백으로 사용한다.
export async function readJsonBody(req) {
  if (!hasBody(req)) return {};
  if (!isJsonContentType(req.headers['content-type'])) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 은 application/json 이어야 해요.');
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  let buf;
  if (req.readableEnded && req.body !== undefined) {
    const b = req.body;
    if (Buffer.isBuffer(b)) buf = b;
    else if (typeof b === 'string') buf = Buffer.from(b);
    else buf = Buffer.from(JSON.stringify(b));
    if (buf.length > MAX_BODY_BYTES) throw tooLarge();
  } else {
    buf = await readStream(req, MAX_BODY_BYTES);
  }
  const text = buf.toString('utf8');
  if (text.trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '올바른 JSON 형식이 아니에요.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_JSON', 'JSON 객체를 보내 주세요.');
  }
  return parsed;
}
