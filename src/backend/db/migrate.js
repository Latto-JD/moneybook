import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './index.js';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

// 카테고리 행을 가진 사용자 수 (categories 테이블이 아직 없으면 0)
async function usersWithCategories(db) {
  const { rows: t } = await db.query(`select to_regclass('public.categories') is not null as ok`);
  if (!t[0].ok) return 0;
  const { rows } = await db.query('select count(distinct user_id)::int as n from categories');
  return rows[0].n;
}

// schema.sql 은 한 번의 exec 로 보내므로 중간에 실패하면 전부 롤백된다 (pg 단순 쿼리, PGlite 모두 확인).
// 반환: { categoryUsers } 이번 실행에서 카테고리 행이 처음 생긴 사용자 수
export async function migrate(db) {
  const sql = await readFile(SCHEMA_PATH, 'utf8');
  const before = await usersWithCategories(db);
  await db.exec(sql);
  const after = await usersWithCategories(db);
  return { categoryUsers: after - before };
}

// CLI: npm run db:migrate
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  let db;
  try {
    db = await createDb(process.env, { forMigration: true });
    const { categoryUsers } = await migrate(db);
    console.log(`마이그레이션 완료 (driver=${db.driver}, categories 생성 사용자=${categoryUsers})`);
  } catch (e) {
    // 연결 문자열이 메시지에 섞일 수 있어 코드/이름만 출력한다
    console.error('마이그레이션 실패:', e.code || e.name, e.code ? '' : e.message?.replace(/\w+:\/\/\S+/g, '[redacted]'));
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
