// 로컬/테스트 어댑터: PGlite(내장 Postgres). 로컬 개발 서버와 테스트에서만 import 한다.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite, types } from '@electric-sql/pglite';

// dir 이 비어 있거나 'memory' 이면 메모리 DB(파일시스템을 건드리지 않는다).
// 파일 DB 이면 dir(와 모든 상위 디렉터리)를 recursive 로 만든다. 새로 클론한 저장소에는 .data/ 가 없다.
// ensureDir=false 이면 디렉터리를 만들지 않는다(index.js 가 Vercel/production 에서 사용).
export async function createPgliteAdapter(dir, { ensureDir = true } = {}) {
  const dataDir = !dir || dir === 'memory' ? undefined : dir;
  if (dataDir && ensureDir) mkdirSync(resolve(dataDir), { recursive: true });
  const db = new PGlite({
    dataDir,
    parsers: {
      [types.DATE]: (v) => v, // 날짜는 문자열 그대로
      [types.INT8]: (v) => Number(v),
    },
  });
  await db.waitReady;
  const run = (c, sql, params) => c.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }));
  return {
    driver: 'pglite',
    query: (sql, params = []) => run(db, sql, params),
    exec: (sql) => db.exec(sql).then(() => undefined),
    transaction: (fn) => db.transaction((tx) => fn({ query: (sql, params = []) => run(tx, sql, params) })),
    close: () => db.close(),
  };
}
