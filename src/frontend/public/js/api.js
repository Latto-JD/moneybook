// API 클라이언트. 같은 출처 쿠키(credentials: 'same-origin'), JSON, 401 처리, 에러 메시지/Retry-After 추출.
// fetch 와 401 핸들러를 주입할 수 있어 Node 에서 단위 테스트 가능.

export class ApiError extends Error {
  constructor({ status, code, message, fields, retryAfter }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields || null;
    this.retryAfter = retryAfter ?? null; // 초 단위 정수 또는 null
  }
}

const STATUS_MESSAGES = {
  0: '네트워크 연결을 확인하고 다시 시도해 주세요.',
  401: '로그인이 필요해요.',
  403: '요청이 거절되었어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
  404: '찾을 수 없어요.',
  413: '요청이 너무 커요.',
  429: '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.',
  500: '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
};

/** Retry-After 헤더(초 단위 정수)를 숫자로. 없거나 형식이 다르면 null. */
export function parseRetryAfter(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

export function buildQuery(query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const AUTH_PATHS = ['/api/auth/login', '/api/auth/signup', '/api/auth/logout'];

export function createApi({ fetchImpl, onUnauthorized = () => {} } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  async function request(method, path, { query, body, noRedirect = false } = {}) {
    const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await doFetch(path + buildQuery(query), init);
    } catch {
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: STATUS_MESSAGES[0] });
    }
    if (res.status === 204) return null;

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok) return data;

    const err = data && data.error ? data.error : {};
    const apiErr = new ApiError({
      status: res.status,
      code: err.code || 'ERROR',
      message: err.message || STATUS_MESSAGES[res.status] || '요청을 처리하지 못했어요.',
      fields: err.fields,
      retryAfter: parseRetryAfter(res.headers && res.headers.get ? res.headers.get('Retry-After') : null),
    });
    // 로그인/가입 실패의 401 은 만료가 아니다. 세션 확인(noRedirect)도 호출자가 처리한다.
    if (res.status === 401 && !noRedirect && !AUTH_PATHS.includes(path)) onUnauthorized(apiErr);
    throw apiErr;
  }

  return {
    request,
    // 인증
    me: () => request('GET', '/api/auth/me', { noRedirect: true }),
    login: (email, password) => request('POST', '/api/auth/login', { body: { email, password } }),
    signup: (email, password) => request('POST', '/api/auth/signup', { body: { email, password } }),
    logout: () => request('POST', '/api/auth/logout'),
    // 거래
    categories: () => request('GET', '/api/categories'),
    listTransactions: (month) => request('GET', '/api/transactions', { query: { month } }),
    createTransaction: (tx) => request('POST', '/api/transactions', { body: tx }),
    updateTransaction: (id, tx) => request('PUT', `/api/transactions/${encodeURIComponent(id)}`, { body: tx }),
    deleteTransaction: (id) => request('DELETE', `/api/transactions/${encodeURIComponent(id)}`),
    summary: (month) => request('GET', '/api/summary', { query: { month } }),
    // 추천/인사이트
    quick: (type, today) => request('GET', '/api/recommendations/quick', { query: { type, today } }),
    autocomplete: (q, type, today) => request('GET', '/api/recommendations/autocomplete', { query: { q, type, today } }),
    insights: (month, today) => request('GET', '/api/insights', { query: { month, today } }),
    // 집계
    statsMonthly: (from, to) => request('GET', '/api/stats/monthly', { query: { from, to } }),
    statsCategories: (from, to, type = 'expense') => request('GET', '/api/stats/categories', { query: { from, to, type } }),
    statsCategoryMonthly: (from, to, type = 'expense') => request('GET', '/api/stats/category-monthly', { query: { from, to, type } }),
  };
}

/** 브라우저 전용 인스턴스: 401 이면 만료 안내와 함께 로그인 화면으로. */
export const api = createApi({
  onUnauthorized: () => {
    location.assign('/login.html?expired=1');
  },
});
