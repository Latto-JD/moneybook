import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';
import { seed } from '../scripts/seed.js';
import { runQaOp, assertQaAllowed } from '../scripts/qa-ops.js';

const script = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const cleanEnv = (extra) => {
  const env = { ...process.env, ...extra };
  for (const k of ['DB_DRIVER', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'PGLITE_DIR', 'VERCEL', 'NODE_ENV']) if (!(k in extra)) delete env[k];
  return env;
};

test('seed: PGlite 가 아닌 DB 는 --yes 없이 실행 거부 (DB 접속 시도 전)', () => {
  const r = spawnSync(process.execPath, [script('seed.js'), '--email=a@ex.com', '--password=password123', '--today=2026-10-19'], {
    env: cleanEnv({ DATABASE_URL: ['post','gres'].join('') + '://u:p@127.0.0.1:1/x' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--yes/);
  assert.ok(!r.stderr.includes('://'));
});

test('seed: 잘못된 인자는 실패', () => {
  const r = spawnSync(process.execPath, [script('seed.js'), '--email=bad', '--password=password123'], {
    env: cleanEnv({ DB_DRIVER: 'pglite', PGLITE_DIR: 'memory' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--email/);
});

test('seed: PGlite 메모리 DB 에 사용자 생성 + 거래, 재실행은 --reset 필요, 다른 사용자 불변', async () => {
  const db = await createPgliteAdapter('memory');
  await migrate(db);
  try {
    await db.query("insert into users (email, password_hash) values ('other@ex.com', 'x')");
    const r1 = await seed(db, { email: 'Seed@Ex.com', password: 'password123', today: '2026-10-19' });
    assert.equal(r1.created, true);
    assert.ok(r1.count >= 100);
    const { rows } = await db.query("select count(*)::int n, min(date) mn from transactions t join users u on u.id = t.user_id where u.email = 'seed@ex.com'");
    assert.equal(rows[0].n, r1.count);
    assert.ok(rows[0].mn <= '2026-04-01', '최소 7개월치');
    await assert.rejects(() => seed(db, { email: 'seed@ex.com', password: 'password123', today: '2026-10-19' }), /--reset/);
    const r2 = await seed(db, { email: 'seed@ex.com', password: 'password123', today: '2026-10-19', reset: true });
    assert.equal(r2.created, false);
    assert.equal((await db.query('select count(*)::int n from transactions')).rows[0].n, r2.count);
    assert.equal((await db.query("select count(*)::int n from users where email = 'other@ex.com'")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('qa-ops: 프로덕션/비 PGlite 환경에서는 거부', async () => {
  assert.throws(() => assertQaAllowed({ DB_DRIVER: 'pglite', VERCEL: '1' }), /프로덕션/);
  assert.throws(() => assertQaAllowed({ DB_DRIVER: 'pglite', NODE_ENV: 'production' }), /프로덕션/);
  assert.throws(() => assertQaAllowed({ DATABASE_URL: 'x' }), /pglite/);
  assert.doesNotThrow(() => assertQaAllowed({ DB_DRIVER: 'pglite' }));
  await assert.rejects(() => runQaOp({}, 'expire-sessions', {}, { VERCEL: '1', DB_DRIVER: 'pglite' }), /프로덕션/);
  await assert.rejects(() => runQaOp({}, 'drop-everything', {}, { DB_DRIVER: 'pglite' }), /알 수 없는/);
  await assert.rejects(() => runQaOp({}, 'constructor', {}, { DB_DRIVER: 'pglite' }), /알 수 없는/);
});

test('qa-ops: 세션 만료/삭제, 시도 기록 이동/삭제, break/repair', async () => {
  const env = { DB_DRIVER: 'pglite' };
  const db = await createPgliteAdapter('memory');
  await migrate(db);
  try {
    const { rows } = await db.query("insert into users (email, password_hash) values ('q@ex.com', 'x') returning id");
    const uid = rows[0].id;
    await db.query("insert into sessions (token_hash, user_id, expires_at) values ('h1', $1, now() + interval '1 day')", [uid]);
    assert.deepEqual(await runQaOp(db, 'expire-sessions', { email: 'Q@ex.com' }, env), { updated: 1 });
    assert.equal((await db.query('select count(*)::int n from sessions where expires_at < now()')).rows[0].n, 1);
    assert.deepEqual(await runQaOp(db, 'delete-sessions', {}, env), { deleted: 1 });

    await db.query("insert into auth_attempts (kind, email, ip, success) values ('login', 'q@ex.com', '1.1.1.1', false)");
    await runQaOp(db, 'age-attempts', { email: 'q@ex.com', minutes: '16' }, env);
    assert.equal((await db.query("select count(*)::int n from auth_attempts where created_at < now() - interval '15 minutes'")).rows[0].n, 1);
    await assert.rejects(() => runQaOp(db, 'age-attempts', { minutes: 'x' }, env), /minutes/);
    assert.deepEqual(await runQaOp(db, 'clear-attempts', {}, env), { deleted: 1 });

    await runQaOp(db, 'break-db', {}, env);
    await assert.rejects(() => db.query('select 1 from transactions'));
    await runQaOp(db, 'repair-db', {}, env);
    await db.query('select 1 from transactions');
  } finally {
    await db.close();
  }
});
