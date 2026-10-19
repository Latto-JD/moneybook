import { createHash, randomBytes } from 'node:crypto';
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '../config.js';
import { parseCookies } from '../http.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at)
     values ($1, $2, now() + make_interval(secs => $3))`,
    [hashToken(token), userId, SESSION_MAX_AGE_SEC],
  );
  return token;
}

export function readSessionToken(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return token && TOKEN_RE.test(token) ? token : null;
}

// 유효한 세션이면 {id, email}, 아니면 null
export async function findSessionUser(db, req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const { rows } = await db.query(
    `select u.id, u.email from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ? { id: rows[0].id, email: rows[0].email } : null;
}

export async function deleteSession(db, token) {
  await db.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

export function sessionCookie(token, config) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_MAX_AGE_SEC}; Path=/; HttpOnly${config.cookieSecure ? '; Secure' : ''}; SameSite=Lax`;
}

export function clearCookie(config) {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly${config.cookieSecure ? '; Secure' : ''}; SameSite=Lax`;
}
