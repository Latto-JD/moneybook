import { ApiError } from '../http.js';
import { ensureDefaults } from '../lib/categories.js';
import { clientIp } from '../security.js';
import { hashPassword, verifyPassword, dummyVerify } from './password.js';
import { normalizeEmail, isValidEmail, isValidPassword } from './validate.js';
import { createSession, deleteSession, readSessionToken, sessionCookie, clearCookie } from './session.js';
import {
  beginLoginAttempt,
  beginSignupAttempt,
  markAttemptSuccess,
  recordAttempt,
  clearLoginFailures,
  cleanup,
} from './attempts.js';

const CLEANUP_PROBABILITY = 0.05;

const userBody = (u) => ({ user: { id: u.id, email: u.email } });

async function signup({ req, db, config, body }) {
  if (!config.signupEnabled) throw new ApiError(403, 'SIGNUP_DISABLED', '지금은 새로 가입할 수 없어요.');
  const email = normalizeEmail(body.email ?? '');
  const fields = {};
  if (typeof body.email !== 'string' || !isValidEmail(email)) fields.email = '올바른 이메일 형식이 아니에요.';
  if (!isValidPassword(body.password)) fields.password = '비밀번호는 8자 이상 128자 이하여야 해요.';
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  }
  const ip = clientIp(req, config);
  const attemptId = await beginSignupAttempt(db, email, ip);

  const passwordHash = await hashPassword(body.password);
  let user;
  try {
    // 사용자와 기본 카테고리 12개를 한 트랜잭션에서 만든다
    user = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        'insert into users (email, password_hash) values ($1, $2) returning id, email',
        [email, passwordHash],
      );
      await ensureDefaults(tx, rows[0].id);
      return rows[0];
    });
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'EMAIL_TAKEN', '이미 가입된 이메일이에요.');
    throw e;
  }
  await markAttemptSuccess(db, attemptId);
  const token = await createSession(db, user.id);
  return { status: 201, body: userBody(user), headers: { 'Set-Cookie': sessionCookie(token, config) } };
}

async function login({ req, db, config, body }) {
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password) {
    const fields = {};
    if (typeof body.email !== 'string' || !body.email.trim()) fields.email = '이메일을 입력해 주세요.';
    if (typeof body.password !== 'string' || !body.password) fields.password = '비밀번호를 입력해 주세요.';
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  }
  const email = normalizeEmail(body.email).slice(0, 254);
  const ip = clientIp(req, config);
  await beginLoginAttempt(db, email, ip);
  // 서버리스는 응답 후 백그라운드 실행이 보장되지 않으므로 낮은 확률로 응답 전에 await 한다.
  if (Math.random() < CLEANUP_PROBABILITY) await cleanup(db).catch(() => {});

  const { rows } = await db.query('select id, email, password_hash from users where email = $1', [email]);
  const user = rows[0];
  const ok = user ? await verifyPassword(body.password.slice(0, 1024), user.password_hash) : await dummyVerify(body.password.slice(0, 1024));
  if (!ok) {
    // 실패 기록은 beginLoginAttempt 에서 이미 남겼다.
    throw new ApiError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 맞지 않아요.');
  }
  await clearLoginFailures(db, email);
  await recordAttempt(db, 'login', email, ip, true);
  const token = await createSession(db, user.id);
  return { status: 200, body: userBody(user), headers: { 'Set-Cookie': sessionCookie(token, config) } };
}

async function logout({ req, db, config }) {
  const token = readSessionToken(req);
  if (token) await deleteSession(db, token);
  return { status: 204, headers: { 'Set-Cookie': clearCookie(config) } };
}

async function me({ user }) {
  return { status: 200, body: userBody(user) };
}

export const authRoutes = [
  { method: 'POST', path: '/api/auth/signup', auth: false, handler: signup },
  { method: 'POST', path: '/api/auth/login', auth: false, handler: login },
  { method: 'POST', path: '/api/auth/logout', auth: false, handler: logout },
  { method: 'GET', path: '/api/auth/me', auth: true, handler: me },
];
