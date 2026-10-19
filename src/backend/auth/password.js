import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

// scrypt$N$r$p$salt(base64)$hash(base64) -- 파라미터를 저장해 향후 상향 가능
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

function maxmemFor(n, r) {
  // 128 * N * r 가 필요 메모리. 여유를 두어 최소 64MB.
  return Math.max(64 * 1024 * 1024, 128 * n * r * 2);
}

function scryptAsync(password, salt, keylen, n, r, p) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: maxmemFor(n, r) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every(Number.isInteger) || n < 2 || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!expected.length) return false;
  const actual = await scryptAsync(password, salt, expected.length, n, r, p);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 존재하지 않는 이메일 로그인 시에도 scrypt 를 1회 수행해 응답 시간 차이를 줄인다.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  try {
    await verifyPassword(password, await dummyHash);
  } catch (e) {
    dummyHash = undefined; // 실패한 Promise 를 캐시하지 않는다
    throw e;
  }
  return false;
}
