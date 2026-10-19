import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './index.js';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export async function migrate(db) {
  const sql = await readFile(SCHEMA_PATH, 'utf8');
  await db.exec(sql);
}

// CLI: npm run db:migrate
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  let db;
  try {
    db = await createDb(process.env, { forMigration: true });
    await migrate(db);
    console.log(`마이그레이션 완료 (driver=${db.driver})`);
  } catch (e) {
    // 연결 문자열이 메시지에 섞일 수 있어 코드/이름만 출력한다
    console.error('마이그레이션 실패:', e.code || e.name, e.code ? '' : e.message?.replace(/\w+:\/\/\S+/g, '[redacted]'));
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
