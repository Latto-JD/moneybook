// QA 용 보조 서버 제어: 별도 포트/임시 PGLITE_DIR 로 개발 서버를 직접 띄우고 끈다.
// README "QA/테스트 지원" 기준: QA_TOOLS=true, DB_DRIVER=pglite, COOKIE_SECURE=false.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let nextPort = Number(process.env.QA_AUX_PORT_BASE || 3201);

export function allocPort() {
  return nextPort++;
}

export function tmpPgliteDir() {
  return mkdtempSync(join(tmpdir(), 'qa-pglite-'));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function baseEnv(dir, port, extra) {
  return {
    ...process.env,
    DB_DRIVER: 'pglite',
    COOKIE_SECURE: 'false',
    QA_TOOLS: 'true',
    TRUST_PROXY: 'false',
    SIGNUP_ENABLED: 'true',
    PGLITE_DIR: dir,
    PORT: String(port),
    ...extra,
  };
}

/** 스키마 적용 (서버가 꺼진 상태에서 호출) */
export function migrate(dir, extra = {}) {
  const r = spawnSync(process.execPath, ['src/backend/db/migrate.js'], {
    cwd: ROOT, env: baseEnv(dir, 0, extra), encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`migrate failed: ${r.stderr || r.stdout}`);
}

/** 개발 서버 기동. 반환: { url, port, dir, stop() } */
export async function startServer({ dir, port, env = {} } = {}) {
  port = port ?? allocPort();
  const child = spawn(process.execPath, ['src/backend/scripts/dev-server.js'], {
    cwd: ROOT, env: baseEnv(dir, port, env), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${log}`);
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) break;
    } catch { /* 아직 기동 전 */ }
    if (Date.now() > deadline) { child.kill(); throw new Error(`server start timeout: ${log}`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  const exited = new Promise((r) => child.once('exit', r));
  return {
    url, port, dir, pid: child.pid, log: () => log,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
        if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      }
    },
  };
}

/** 서버가 꺼진 상태에서 PGlite 데이터 디렉터리를 직접 조회 (루트 node_modules 의 PGlite 사용). 행 배열 반환 */
export function dbQuery(dir, sql) {
  const code = `
    import { PGlite } from '@electric-sql/pglite';
    const db = new PGlite(process.env.QA_DIR);
    await db.waitReady;
    const r = await db.query(process.env.QA_SQL);
    console.log(JSON.stringify(r.rows));
    await db.close();`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT, env: { ...process.env, QA_DIR: dir, QA_SQL: sql }, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`dbQuery failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

/** QA_TOOLS 서버의 /__qa/<op> 호출 */
export async function qaOp(baseUrl, op, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${baseUrl}/__qa/${op}${qs ? `?${qs}` : ''}`, { method: 'POST', headers: { 'X-QA-Tools': '1' } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
