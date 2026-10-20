import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';

test('migrate 는 두 번 실행해도 오류가 없다 (멱등)', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    await migrate(db);
    const { rows } = await db.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_name),
      ['auth_attempts', 'categories', 'sessions', 'transactions', 'users'],
    );
  } finally {
    await db.close();
  }
});

test('DATE 는 문자열, bigint 는 숫자로 반환된다', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    const u = await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`);
    const uid = u.rows[0].id;
    await db.query(
      `insert into transactions (user_id, type, amount, category, memo, date) values ($1, 'expense', 4500, '식비', '', $2)`,
      [uid, '2026-09-30'],
    );
    const { rows } = await db.query(
      'select date, sum(amount) as total, count(*) as n from transactions where user_id = $1 group by date',
      [uid],
    );
    assert.equal(rows[0].date, '2026-09-30');
    assert.equal(rows[0].total, 4500);
    assert.equal(typeof rows[0].total, 'number');
    assert.equal(rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('CHECK 제약과 FK ON DELETE CASCADE', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    const u = await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x') returning id`);
    const uid = u.rows[0].id;
    await assert.rejects(
      db.query(`insert into transactions (user_id, type, amount, category, date) values ($1, 'expense', 0, '식비', '2026-01-01')`, [uid]),
    );
    await assert.rejects(
      db.query(`insert into transactions (user_id, type, amount, category, date) values ($1, 'foo', 1, '식비', '2026-01-01')`, [uid]),
    );
    await db.query(`insert into transactions (user_id, type, amount, category, date) values ($1, 'income', 100000000, '급여', '2026-01-01')`, [uid]);
    await db.query('delete from users where id = $1', [uid]);
    const { rows } = await db.query('select count(*) as n from transactions');
    assert.equal(rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('transaction 은 오류 시 롤백한다', async () => {
  const db = await createPgliteAdapter('memory');
  try {
    await migrate(db);
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query(`insert into users (email, password_hash) values ('a@ex.com', 'x')`);
        throw new Error('boom');
      }),
      /boom/,
    );
    const { rows } = await db.query('select count(*) as n from users');
    assert.equal(rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('PGLITE_DIR 의 없는 상위 디렉터리를 자동 생성한다', async () => {
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createDb } = await import('../db/index.js');
  const base = mkdtempSync(join(tmpdir(), 'pglite-mk-'));
  try {
    const dir = join(base, 'a', 'b', 'c');
    const db = await createDb({ DB_DRIVER: 'pglite', PGLITE_DIR: dir });
    try {
      await migrate(db);
      assert.ok(existsSync(dir));
    } finally {
      await db.close();
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('memory 모드, VERCEL, production 에서는 디렉터리를 만들지 않는다', async () => {
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createDb } = await import('../db/index.js');
  const base = mkdtempSync(join(tmpdir(), 'pglite-nomk-'));
  try {
    const mem = await createPgliteAdapter('memory');
    await mem.close();
    assert.equal(existsSync(join(base, 'memory')), false);
    for (const extra of [{ VERCEL: '1' }, { NODE_ENV: 'production' }]) {
      const dir = join(base, 'x', JSON.stringify(extra).length + '', 'y');
      // 디렉터리를 만들지 않으므로 PGlite 가 실패하는 것이 정상 (어댑터가 fs 를 건드리지 않음을 확인)
      await createDb({ DB_DRIVER: 'pglite', PGLITE_DIR: dir, ...extra }).then((d) => d.close(), () => {});
      assert.equal(existsSync(join(base, 'x')), false);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
