// 운영 DB 마이그레이션 전용: npm run db:migrate:prod -- --yes
// .env.production.local 만 읽는다 (vercel env pull .env.production.local --environment=production).
// DB_DRIVER 가 설정되어 있으면 로컬 DB 에 적용될 수 있으므로 거부하고, --yes 없이는 실행하지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgAdapter } from '../db/pg.js';
import { migrate } from '../db/migrate.js';

export const ENV_FILE = '.env.production.local';

// KEY=VALUE 줄만 해석한다 (주석, export 접두, 따옴표 처리). 값은 어디에도 출력하지 않는다.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || raw.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const mask = (s) => String(s ?? '').replace(/\w+:\/\/\S+/g, '[redacted]');

// 반환: { code, lines }. connect(url) 는 테스트에서 주입할 수 있다.
export async function runMigrateProd({ argv = [], env = process.env, cwd = process.cwd(), connect = createPgAdapter } = {}) {
  const fail = (...lines) => ({ code: 1, lines });
  const file = path.join(cwd, ENV_FILE);
  if (!existsSync(file)) {
    return fail(
      `${ENV_FILE} 파일이 없어요.`,
      `먼저 'vercel env pull ${ENV_FILE} --environment=production' 으로 받아 주세요.`,
    );
  }
  const fromFile = parseEnvFile(readFileSync(file, 'utf8'));
  if ('DB_DRIVER' in fromFile || env.DB_DRIVER !== undefined) {
    return fail('DB_DRIVER 가 설정되어 있어요. 로컬 DB 에 적용될 수 있어서 운영 마이그레이션을 거부합니다.');
  }
  const url = fromFile.DATABASE_URL_UNPOOLED || fromFile.DATABASE_URL;
  if (!url) return fail(`${ENV_FILE} 에 DATABASE_URL_UNPOOLED 또는 DATABASE_URL 이 없어요.`);
  if (!argv.includes('--yes')) {
    return fail(
      '운영 DB(driver=pg)에 스키마를 적용합니다. 백업 브랜치를 만든 뒤 --yes 를 붙여 다시 실행하세요.',
      '예: npm run db:migrate:prod -- --yes',
    );
  }
  let db;
  try {
    db = await connect(url);
    const { categoryUsers } = await migrate(db);
    return { code: 0, lines: [`마이그레이션 완료 (driver=${db.driver}, categories 생성 사용자=${categoryUsers})`] };
  } catch (e) {
    // 연결 문자열이 섞일 수 있어 코드/이름만 출력한다
    return fail(`마이그레이션 실패: ${e.code || e.name} ${e.code ? '' : mask(e.message)}`.trim());
  } finally {
    await db?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { code, lines } = await runMigrateProd({ argv: process.argv.slice(2) });
  for (const l of lines) (code ? console.error : console.log)(l);
  process.exitCode = code;
}
