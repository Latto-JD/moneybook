// DB 어댑터 선택. PGlite 는 DB_DRIVER=pglite 일 때만, 변수 경로로 동적 import 하여
// 배포 함수 번들 추적(정적 분석)에 PGlite 가 포함되지 않게 한다.
import { createPgAdapter } from './pg.js';

let cached;

export async function createDb(env = process.env, { forMigration = false } = {}) {
  if (env.DB_DRIVER === 'pglite') {
    const modulePath = './pglite.js';
    const { createPgliteAdapter } = await import(modulePath);
    // Vercel/production 에서는 파일시스템에 디렉터리를 만들지 않는다.
    const ensureDir = !env.VERCEL && env.NODE_ENV !== 'production';
    return createPgliteAdapter(env.PGLITE_DIR || '.data/pglite', { ensureDir });
  }
  const url = forMigration ? env.DATABASE_URL_UNPOOLED || env.DATABASE_URL : env.DATABASE_URL;
  return createPgAdapter(url);
}

// 프로세스(서버리스 인스턴스) 단위로 하나만 만든다. 실패하면 다음 호출에서 다시 시도한다.
export function getDb() {
  if (!cached) {
    cached = createDb().catch((e) => {
      cached = undefined;
      throw e;
    });
  }
  return cached;
}
