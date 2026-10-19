import { ApiError } from '../http.js';

export const LIMITS = {
  loginEmail: { max: 5, windowSec: 15 * 60 },
  loginIp: { max: 20, windowSec: 15 * 60 },
  signupIp: { max: 10, windowSec: 60 * 60 },
};

function tooMany(retryAfter) {
  const secs = Math.max(1, Math.ceil(retryAfter));
  return new ApiError(429, 'TOO_MANY_ATTEMPTS', `시도가 너무 많아요. ${Math.ceil(secs / 60)}분 후 다시 시도해 주세요.`, {
    headers: { 'Retry-After': String(secs) },
  });
}

async function count(db, where, params, windowSec) {
  const { rows } = await db.query(
    `select count(*)::int as n,
            coalesce(ceil(extract(epoch from (min(created_at) + make_interval(secs => $${params.length + 1}) - now()))), 0)::int as retry
       from auth_attempts
      where ${where} and created_at > now() - make_interval(secs => $${params.length + 1})`,
    [...params, windowSec],
  );
  return rows[0];
}

async function insertAttempt(db, kind, email, ip, success) {
  const { rows } = await db.query(
    'insert into auth_attempts (kind, email, ip, success) values ($1, $2, $3, $4) returning id',
    [kind, email, ip, success],
  );
  return rows[0].id;
}

async function discardAttempt(db, id) {
  await db.query('delete from auth_attempts where id = $1', [id]);
}

// 로그인 시도 선점: 비밀번호 검증 전에 실패 기록을 먼저 넣고, 그 기록을 포함해 횟수를 센다.
// 병렬 요청도 각자 기록을 먼저 커밋하므로 한도(이메일 실패 5/15분, IP 실패 20/15분)를 우회할 수 없다.
// 한도 초과(count > max)면 자기 기록을 지우고(차단된 요청이 윈도를 늘리지 않게) 429.
// 반환값은 시도 id. 성공 시 clearLoginFailures 로 정리된다.
export async function beginLoginAttempt(db, email, ip) {
  const id = await insertAttempt(db, 'login', email, ip, false);
  try {
    const byEmail = await count(db, `kind = 'login' and email = $1 and success = false`, [email], LIMITS.loginEmail.windowSec);
    if (byEmail.n > LIMITS.loginEmail.max) throw tooMany(byEmail.retry);
    const byIp = await count(db, `kind = 'login' and ip = $1 and success = false`, [ip], LIMITS.loginIp.windowSec);
    if (byIp.n > LIMITS.loginIp.max) throw tooMany(byIp.retry);
  } catch (e) {
    await discardAttempt(db, id).catch(() => {});
    throw e;
  }
  return id;
}

// 가입 시도 선점 (IP 당 10회/시간, 성공/실패 모두 포함, 자기 기록 포함 count > max 면 429)
export async function beginSignupAttempt(db, email, ip) {
  const id = await insertAttempt(db, 'signup', email, ip, false);
  try {
    const byIp = await count(db, `kind = 'signup' and ip = $1`, [ip], LIMITS.signupIp.windowSec);
    if (byIp.n > LIMITS.signupIp.max) throw tooMany(byIp.retry);
  } catch (e) {
    await discardAttempt(db, id).catch(() => {});
    throw e;
  }
  return id;
}

export async function markAttemptSuccess(db, id) {
  await db.query('update auth_attempts set success = true where id = $1', [id]);
}

export async function recordAttempt(db, kind, email, ip, success) {
  await insertAttempt(db, kind, email, ip, success);
}

export async function clearLoginFailures(db, email) {
  await db.query(`delete from auth_attempts where kind = 'login' and email = $1 and success = false`, [email]);
}

// 오래된 기록 정리 (로그인 처리 중 수시 호출). 실패해도 로그인 흐름에 영향 없음.
export async function cleanup(db) {
  await db.query(`delete from auth_attempts where created_at < now() - interval '1 day'`);
  await db.query('delete from sessions where expires_at < now()');
}
