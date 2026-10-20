import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPgliteAdapter } from '../db/pglite.js';
import { ENV_FILE, parseEnvFile, runMigrateProd } from '../scripts/migrate-prod.js';

// 실제 접속 정보가 아닌 가짜 값. 연결 시도는 주입한 connect 로 대체한다.
const FAKE_URL = ['post', 'gres'].join('') + '://user:secret@127.0.0.1:1/db';

async function withEnvFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'migprod-'));
  try {
    if (content !== null) writeFileSync(join(dir, ENV_FILE), content);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const neverConnect = () => {
  throw new Error('연결하면 안 돼요');
};

test('parseEnvFile: 주석·따옴표·export 처리', () => {
  const env = parseEnvFile(`# c\nA="x y"\nexport B='z'\nC=plain\n  D = 1 \nbad line\n#E=no\n`);
  assert.deepEqual(env, { A: 'x y', B: 'z', C: 'plain', D: '1' });
});

test('환경 파일이 없으면 종료 코드 1 (연결 안 함)', async () => {
  await withEnvFile(null, async (cwd) => {
    const r = await runMigrateProd({ argv: ['--yes'], env: {}, cwd, connect: neverConnect });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /vercel env pull/);
  });
});

test('--yes 가 없으면 실행하지 않는다 (연결 안 함, 접속 정보 비노출)', async () => {
  await withEnvFile(`DATABASE_URL="${FAKE_URL}"\n`, async (cwd) => {
    const r = await runMigrateProd({ argv: [], env: {}, cwd, connect: neverConnect });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /--yes/);
    assert.match(r.lines.join('\n'), /driver=pg/);
    assert.ok(!r.lines.join('\n').includes('secret'));
  });
});

test('DB_DRIVER 가 파일이나 프로세스 환경에 있으면 값과 무관하게 거부', async () => {
  await withEnvFile(`DATABASE_URL="${FAKE_URL}"\nDB_DRIVER=pglite\n`, async (cwd) => {
    const r = await runMigrateProd({ argv: ['--yes'], env: {}, cwd, connect: neverConnect });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /DB_DRIVER/);
  });
  await withEnvFile(`DATABASE_URL="${FAKE_URL}"\n`, async (cwd) => {
    for (const v of ['pglite', '', 'pg']) {
      const r = await runMigrateProd({ argv: ['--yes'], env: { DB_DRIVER: v }, cwd, connect: neverConnect });
      assert.equal(r.code, 1, `DB_DRIVER=${JSON.stringify(v)}`);
    }
  });
});

test('접속 정보가 없으면 종료 코드 1', async () => {
  await withEnvFile('OTHER=1\n', async (cwd) => {
    const r = await runMigrateProd({ argv: ['--yes'], env: {}, cwd, connect: neverConnect });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /DATABASE_URL/);
  });
});

test('DATABASE_URL_UNPOOLED 를 우선 사용하고, 성공 출력에 driver 와 생성 사용자 수, 재실행은 0', async () => {
  const unpooled = FAKE_URL.replace('/db', '/unpooled');
  await withEnvFile(`DATABASE_URL="${FAKE_URL}"\nDATABASE_URL_UNPOOLED="${unpooled}"\n`, async (cwd) => {
    const db = await createPgliteAdapter('memory');
    try {
      await db.exec(`create table users (id uuid primary key default gen_random_uuid(), email text not null unique check (char_length(email) between 3 and 254), password_hash text not null, created_at timestamptz not null default now())`);
      await db.query(`insert into users (email, password_hash) values ('a@ex.com', 'x'), ('b@ex.com', 'x')`);
      let usedUrl;
      const connect = (url) => {
        usedUrl = url;
        return { ...db, close: async () => {} }; // 같은 DB 를 두 번 쓰므로 닫지 않는다
      };
      const r1 = await runMigrateProd({ argv: ['--yes'], env: {}, cwd, connect });
      assert.equal(usedUrl, unpooled);
      assert.equal(r1.code, 0, r1.lines.join('\n'));
      assert.equal(r1.lines[0], '마이그레이션 완료 (driver=pglite, categories 생성 사용자=2)');
      const r2 = await runMigrateProd({ argv: ['--yes'], env: {}, cwd, connect });
      assert.equal(r2.lines[0], '마이그레이션 완료 (driver=pglite, categories 생성 사용자=0)');
      assert.equal((await db.query('select count(*)::int n from categories')).rows[0].n, 24);
    } finally {
      await db.close();
    }
  });
});

test('연결 실패 메시지에 접속 문자열이 나오지 않는다', async () => {
  await withEnvFile(`DATABASE_URL="${FAKE_URL}"\n`, async (cwd) => {
    const connect = () => {
      throw new Error(`connect failed ${FAKE_URL}`);
    };
    const r = await runMigrateProd({ argv: ['--yes'], env: {}, cwd, connect });
    assert.equal(r.code, 1);
    const out = r.lines.join('\n');
    assert.match(out, /마이그레이션 실패/);
    assert.ok(!out.includes('secret') && !out.includes('://'));
  });
});

test('CLI: .env.production.local 이 없는 디렉터리에서 실행하면 종료 코드 1 (프로젝트 .env 는 읽지 않음)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migprod-cli-'));
  try {
    writeFileSync(join(dir, '.env'), `DB_DRIVER=pglite\nDATABASE_URL=${FAKE_URL}\n`);
    const script = fileURLToPath(new URL('../scripts/migrate-prod.js', import.meta.url));
    const env = { ...process.env };
    for (const k of ['DB_DRIVER', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED']) delete env[k];
    const r = spawnSync(process.execPath, [script, '--yes'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\.env\.production\.local/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
