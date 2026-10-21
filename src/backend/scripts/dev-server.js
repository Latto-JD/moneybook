// 로컬 개발 서버: src/frontend/public 정적 파일 + /api/* 를 Vercel 과 같은 핸들러로 처리
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../app.js';
import { applySecurityHeaders } from '../http.js';
import { getDb } from '../db/index.js';

const ROOT = fileURLToPath(new URL('../../frontend/public', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, root) {
  applySecurityHeaders(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad Request');
  }
  if (pathname.includes('\0')) {
    res.statusCode = 400;
    return res.end('Bad Request');
  }
  let file = path.join(root, pathname);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  try {
    let s = await stat(file);
    if (s.isDirectory()) {
      file = path.join(file, 'index.html');
      s = await stat(file);
    }
    const data = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Length', data.length);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  }
}

// 원격 주소가 루프백인지 (IPv4-mapped IPv6 허용)
export function isLoopbackRemote(remoteAddress) {
  const remote = (remoteAddress || '').replace(/^::ffff:/, '');
  return ['127.0.0.1', '::1'].includes(remote);
}

// Host 헤더가 localhost / 127.0.0.1 / [::1] (선택적 포트) 인지
export function isLocalHostHeader(hostHeader) {
  const host = String(hostHeader || '').replace(/:\d+$/, '').toLowerCase();
  return ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

// QA 전용 엔드포인트 (QA_TOOLS=true, DB_DRIVER=pglite, 프로덕션 아님, 루프백 요청, X-QA-Tools 헤더 필수일 때만)
// POST /__qa/<명령>?email=&minutes=  -> 같은 프로세스의 DB 에 직접 적용 (PGlite 동시 열기 문제 회피)
async function handleQa(req, res, env) {
  const json = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  try {
    const { assertQaAllowed, runQaOp } = await import('./qa-ops.js');
    assertQaAllowed(env);
    if (!isLoopbackRemote(req.socket.remoteAddress)) return json(403, { error: '로컬 요청만 허용돼요.' });
    if (!isLocalHostHeader(req.headers.host)) return json(403, { error: 'Host 가 localhost 여야 해요.' });
    if (req.method !== 'POST' || req.headers['x-qa-tools'] !== '1') {
      return json(400, { error: 'POST 와 X-QA-Tools: 1 헤더가 필요해요.' });
    }
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname.replace(/^\/__qa\//, '');
    const db = await getDb();
    return json(200, await runQaOp(db, name, Object.fromEntries(url.searchParams), env));
  } catch (e) {
    return json(400, { error: e.message });
  }
}

export function createDevServer({ handler = createHandler(), root = ROOT, env = process.env } = {}) {
  const qaEnabled = env.QA_TOOLS === 'true';
  return http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (qaEnabled && pathname.startsWith('/__qa/')) return handleQa(req, res, env);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handler(req, res);
    return serveStatic(req, res, root);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT) || 3000;
  const server = createDevServer();
  server.listen(port, () => {
    console.log(`개발 서버 실행 중: http://localhost:${port} (db=${process.env.DB_DRIVER || 'pg'})`);
  });
}
