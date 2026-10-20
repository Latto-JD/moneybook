import { healthRoutes } from './routes/health.js';
import { authRoutes } from './auth/routes.js';
import { categoryRoutes } from './categories/routes.js';
import { transactionRoutes } from './transactions/routes.js';
import { statsRoutes } from './stats/routes.js';
import { ruleRoutes } from './rules/routes.js';

// 라우트 정의: { method, path('/api/x/:id'), auth(기본 true), handler(ctx) -> {status, body, headers} }
export const routes = [...healthRoutes, ...authRoutes, ...categoryRoutes, ...transactionRoutes, ...statsRoutes, ...ruleRoutes];

function compile(route) {
  const names = [];
  const re = new RegExp(
    '^' +
      route.path.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : '\\' + c)).replace(/:(\w+)/g, (_, n) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '/?$',
  );
  return { route, re, names };
}

const compiled = routes.map(compile);

// 반환: {route, params} | {methodNotAllowed: [methods]} | null
export function matchRoute(method, pathname) {
  const allowed = [];
  for (const { route, re, names } of compiled) {
    const m = re.exec(pathname);
    if (!m) continue;
    if (route.method === method) {
      const params = {};
      names.forEach((n, i) => {
        try {
          params[n] = decodeURIComponent(m[i + 1]);
        } catch {
          params[n] = m[i + 1];
        }
      });
      return { route, params };
    }
    allowed.push(route.method);
  }
  return allowed.length ? { methodNotAllowed: allowed } : null;
}
