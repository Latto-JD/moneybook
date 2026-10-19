// QA/개발 전용 DB 조작 모음. 프로덕션에서는 동작하지 않는다 (api/ 경로에서 import 하지 않음).
// 허용 조건: DB_DRIVER=pglite 이고 VERCEL, NODE_ENV=production 이 아닐 것.

export function assertQaAllowed(env = process.env) {
  if (env.VERCEL || env.NODE_ENV === 'production') {
    throw new Error('프로덕션 환경에서는 사용할 수 없어요.');
  }
  if (env.DB_DRIVER !== 'pglite') {
    throw new Error('DB_DRIVER=pglite 일 때만 사용할 수 있어요.');
  }
}

const emailFilter = `user_id in (select id from users where email = $1)`;

export const QA_OPS = {
  // 세션 만료(expires_at 을 하루 전으로). email 생략 시 전체 세션
  async 'expire-sessions'(db, { email }) {
    const r = email
      ? await db.query(`update sessions set expires_at = now() - interval '1 day' where ${emailFilter}`, [email.trim().toLowerCase()])
      : await db.query(`update sessions set expires_at = now() - interval '1 day'`);
    return { updated: r.rowCount };
  },
  // 세션 삭제 (사용 중 세션이 사라진 상황)
  async 'delete-sessions'(db, { email }) {
    const r = email
      ? await db.query(`delete from sessions where ${emailFilter}`, [email.trim().toLowerCase()])
      : await db.query('delete from sessions');
    return { deleted: r.rowCount };
  },
  // 로그인/가입 시도 기록을 minutes 분 과거로 이동 (시도 제한 해제 검증). email 생략 시 전체
  async 'age-attempts'(db, { email, minutes }) {
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 1440) throw new Error('minutes 는 1~1440 정수여야 해요.');
    const r = email
      ? await db.query(`update auth_attempts set created_at = created_at - make_interval(mins => $1::int) where email = $2`, [mins, email.trim().toLowerCase()])
      : await db.query(`update auth_attempts set created_at = created_at - make_interval(mins => $1::int)`, [mins]);
    return { updated: r.rowCount };
  },
  // 시도 기록 전체 삭제
  async 'clear-attempts'(db) {
    const r = await db.query('delete from auth_attempts');
    return { deleted: r.rowCount };
  },
  // 내부 오류 재현: transactions 테이블 이름을 바꿔 거래/요약/통계/추천 API 가 500 이 되게 한다 (인증/health 는 정상)
  async 'break-db'(db) {
    const { rows } = await db.query(`select to_regclass('public.transactions') as t`);
    if (rows[0].t) await db.exec('alter table transactions rename to transactions_qa_broken');
    return { broken: true };
  },
  async 'repair-db'(db) {
    const { rows } = await db.query(`select to_regclass('public.transactions_qa_broken') as t`);
    if (rows[0].t) await db.exec('alter table transactions_qa_broken rename to transactions');
    return { broken: false };
  },
};

export async function runQaOp(db, name, args = {}, env = process.env) {
  assertQaAllowed(env);
  const op = Object.hasOwn(QA_OPS, name) ? QA_OPS[name] : undefined;
  if (!op) throw new Error(`알 수 없는 명령이에요: ${name} (사용 가능: ${Object.keys(QA_OPS).join(', ')})`);
  return op(db, args);
}
