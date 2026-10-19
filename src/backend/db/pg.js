// 프로덕션 어댑터: node-postgres(pg) 풀.
// 어댑터 인터페이스: query(sql, params) -> {rows, rowCount}, exec(sql), transaction(fn(tx)), close()
import pg from 'pg';

// DATE 는 JS Date(로컬 시간대)로 바꾸면 하루 밀릴 수 있으므로 문자열 그대로, bigint(SUM/COUNT)는 숫자로 변환한다.
const DATE_OID = 1082;
const INT8_OID = 20;
const types = {
  getTypeParser(oid, format) {
    if (oid === DATE_OID) return (v) => v;
    if (oid === INT8_OID) return (v) => Number(v);
    return pg.types.getTypeParser(oid, format);
  },
};

export function createPgAdapter(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL 이 설정되지 않았어요.');
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    types,
  });
  // 유휴 클라이언트 오류가 프로세스를 죽이지 않게 한다 (연결 문자열은 로그에 남기지 않음)
  pool.on('error', (err) => console.error('[pg] idle client error:', err.code || err.name));

  const run = (client, sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
  return {
    driver: 'pg',
    query: (sql, params = []) => run(pool, sql, params),
    exec: (sql) => pool.query(sql).then(() => undefined),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params = []) => run(client, sql, params) });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
