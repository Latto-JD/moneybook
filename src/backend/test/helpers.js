import http from 'node:http';
import { createPgliteAdapter } from '../db/pglite.js';
import { migrate } from '../db/migrate.js';
import { createHandler } from '../app.js';

// PGlite 메모리 DB + 실제 HTTP 서버(포트 0)로 핸들러를 구동한다.
export async function startApp(envOverrides = {}, { now } = {}) {
  const db = await createPgliteAdapter('memory');
  await migrate(db);
  const env = { COOKIE_SECURE: 'false', ...envOverrides };
  const handler = createHandler({ getDb: async () => db, env, now });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  // opts: { body (객체), raw (문자열), headers, cookie, origin (기본 허용 Origin, null 이면 생략) }
  async function request(method, path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const origin = opts.origin === undefined ? `http://127.0.0.1:${port}` : opts.origin;
    if (origin) headers.Origin = origin;
    if (opts.cookie) headers.Cookie = opts.cookie;
    let payload;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (opts.body !== undefined) payload = JSON.stringify(opts.body);
    if (payload !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) headers['Content-Length'] = Buffer.byteLength(payload);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  return {
    db,
    port,
    request,
    async close() {
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
      await db.close();
    },
  };
}

export function cookieFrom(res) {
  const sc = res.headers['set-cookie'];
  const line = Array.isArray(sc) ? sc.find((c) => c.startsWith('mb_sid=')) : sc;
  return line ? line.split(';')[0] : null;
}

export const GOOD_PASSWORD = 'correct horse battery';
