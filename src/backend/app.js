// 프레임워크 독립 (req, res) 핸들러. Vercel 함수와 로컬 개발 서버가 같은 핸들러를 쓴다.
import { readConfig } from './config.js';
import { ApiError, applySecurityHeaders, errorResult, readJsonBody, sendResult } from './http.js';
import { checkOrigin, isStateChanging } from './security.js';
import { matchRoute } from './router.js';
import { findSessionUser } from './auth/session.js';
import { getDb } from './db/index.js';

// options: { getDb: () => Promise<db>, env }  (테스트에서 주입)
export function createHandler(options = {}) {
  const dbProvider = options.getDb || getDb;
  const env = options.env || process.env;

  return async function handler(req, res) {
    applySecurityHeaders(res);
    res.setHeader('Cache-Control', 'no-store');
    let result;
    try {
      const config = readConfig(env);
      const method = (req.method || 'GET').toUpperCase();
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      const matched = matchRoute(method, pathname);
      if (!matched) throw new ApiError(404, 'NOT_FOUND', '존재하지 않는 경로예요.');
      if (matched.methodNotAllowed) {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', '허용되지 않는 메서드예요.', {
          headers: { Allow: [...new Set(matched.methodNotAllowed)].join(', ') },
        });
      }
      const { route, params } = matched;

      if (isStateChanging(method)) checkOrigin(req, config);
      const body = isStateChanging(method) ? await readJsonBody(req) : {};
      const url = new URL(req.url || '/', 'http://localhost');
      const ctx = {
        req,
        config,
        params,
        body,
        query: Object.fromEntries(url.searchParams),
        getDb: dbProvider,
        env,
        now: options.now || (() => new Date()), // 테스트에서 현재 시각 고정용
      };
      if (route.needsDb !== false) ctx.db = await dbProvider();
      if (route.auth !== false) {
        const user = await findSessionUser(ctx.db, req);
        if (!user) throw new ApiError(401, 'UNAUTHENTICATED', '로그인이 필요해요.');
        ctx.user = user;
      }
      result = await route.handler(ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        result = errorResult(err);
      } else {
        // 비밀번호/토큰/연결 문자열이 섞이지 않도록 오류 이름과 코드만 기록한다
        console.error('[api] internal error:', err?.name, err?.code);
        result = errorResult(
          new ApiError(500, 'INTERNAL_ERROR', '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'),
        );
      }
    }
    sendResult(res, result);
  };
}

export default createHandler();
