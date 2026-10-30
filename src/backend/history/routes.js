import { ApiError } from '../http.js';
import { TYPES } from '../lib/categories.js';
import { isValidDateStr } from '../lib/dates.js';
import { toTransaction } from '../transactions/routes.js';

export const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 커서의 created_at: DB 마이크로초 값을 UTC 텍스트로 그대로 담는다(밀리초 ISO 를 쓰면 쪽 경계에서 행이 빠지거나 겹친다)
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CONTROL_RE = /\p{Cc}/u;
const DEFAULT_LIMIT = 30;

const ORDER_BY = {
  date_desc: 'date desc, created_at desc, id desc',
  date_asc: 'date asc, created_at asc, id asc',
  amount_desc: 'amount desc, date desc, created_at desc, id desc',
  amount_asc: 'amount asc, date desc, created_at desc, id desc',
};

const MSG_CURSOR_BAD = '목록 위치가 올바르지 않아요.';
const MSG_CURSOR_SORT = '정렬이 바뀌어 목록 위치를 쓸 수 없어요. 처음부터 다시 불러와 주세요.';

// 형식뿐 아니라 실제 시각인지 확인한다(위조 값이 ::timestamptz 캐스트에서 500 이 되지 않게)
function isValidCursorTs(v) {
  if (typeof v !== 'string' || !TS_RE.test(v)) return false;
  const h = Number(v.slice(11, 13));
  const m = Number(v.slice(14, 16));
  const sec = Number(v.slice(17, 19));
  return isValidDateStr(v.slice(0, 10)) && h <= 23 && m <= 59 && sec <= 59;
}

function decodeCursor(raw) {
  let c;
  try {
    c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  if (!SORTS.includes(c.s)) return null;
  if (typeof c.d !== 'string' || !isValidDateStr(c.d)) return null;
  if (!isValidCursorTs(c.c)) return null;
  if (typeof c.i !== 'string' || !UUID_RE.test(c.i)) return null;
  if (c.s.startsWith('amount_') && !(Number.isInteger(c.a) && c.a >= 1 && c.a <= 100_000_000)) return null;
  return c;
}

function encodeCursor(sort, row) {
  const c = { s: sort, d: row.date_text, c: row.cursor_ts, i: row.id };
  if (sort.startsWith('amount_')) c.a = Number(row.amount);
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function parseHistoryQuery(query) {
  const fields = {};
  const { type, category } = query;
  if (!TYPES.includes(type)) fields.type = 'type 은 expense 또는 income 이어야 해요.';
  if (typeof category !== 'string' || category === '' || [...category].length > 50 || CONTROL_RE.test(category)) {
    fields.category = 'category 는 제어문자 없는 1~50자 문자열이어야 해요.';
  }
  let sort = 'date_desc';
  if (query.sort !== undefined) {
    if (SORTS.includes(query.sort)) sort = query.sort;
    else fields.sort = 'sort 는 date_desc, date_asc, amount_desc, amount_asc 중 하나여야 해요.';
  }
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (/^\d{1,3}$/.test(query.limit) && Number(query.limit) >= 1 && Number(query.limit) <= 100) limit = Number(query.limit);
    else fields.limit = 'limit 은 1 이상 100 이하의 정수여야 해요.';
  }
  let cursor = null;
  if (query.cursor !== undefined) {
    const c = typeof query.cursor === 'string' && query.cursor !== '' ? decodeCursor(query.cursor) : null;
    if (!c) fields.cursor = MSG_CURSOR_BAD;
    else if (!fields.sort && c.s !== sort) fields.cursor = MSG_CURSOR_SORT;
    else cursor = c;
  }
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  }
  return { type, category, sort, limit, cursor };
}

// 다음 쪽 조건. K = (date, created_at, id). amount_asc 는 금액 오름차순 + 동점 안 최신 먼저라 방향이 섞인다.
function cursorClause(sort, cursor, p) {
  const k = '(date, created_at, id)';
  const kv = `($${p}::date, $${p + 1}::timestamptz, $${p + 2}::uuid)`;
  const params = [cursor.d, cursor.c, cursor.i];
  switch (sort) {
    case 'date_desc':
      return { sql: ` and ${k} < ${kv}`, params };
    case 'date_asc':
      return { sql: ` and ${k} > ${kv}`, params };
    case 'amount_desc':
      return { sql: ` and (amount < $${p + 3}::int or (amount = $${p + 3}::int and ${k} < ${kv}))`, params: [...params, cursor.a] };
    default:
      return { sql: ` and (amount > $${p + 3}::int or (amount = $${p + 3}::int and ${k} < ${kv}))`, params: [...params, cursor.a] };
  }
}

async function history({ db, user, query }) {
  const { type, category, sort, limit, cursor } = parseHistoryQuery(query);
  const base = [user.id, type, category];
  const cur = cursor ? cursorClause(sort, cursor, 4) : { sql: '', params: [] };

  const listSql = `select id, type, amount, category, memo, date, created_at, date::text as date_text,
         to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
    from transactions
   where user_id = $1 and type = $2 and category = $3${cur.sql}
   order by ${ORDER_BY[sort]}
   limit $${4 + cur.params.length}::int`;
  const monthSql = `select to_char(date, 'YYYY-MM') as month, sum(amount)::bigint as total, count(*)::bigint as count,
         min(date)::text as first_date, max(date)::text as last_date
    from transactions
   where user_id = $1 and type = $2 and category = $3
   group by 1 order by 1 desc`;

  const [list, monthly] = await Promise.all([db.query(listSql, [...base, ...cur.params, limit + 1]), db.query(monthSql, base)]);

  const months = monthly.rows.map((r) => ({ month: r.month, total: Number(r.total), count: Number(r.count) }));
  const rows = list.rows.slice(0, limit);
  const hasMore = list.rows.length > limit;
  return {
    status: 200,
    body: {
      type,
      category,
      sort,
      total: months.reduce((a, m) => a + m.total, 0),
      count: months.reduce((a, m) => a + m.count, 0),
      firstDate: monthly.rows.length ? monthly.rows.at(-1).first_date : null,
      lastDate: monthly.rows.length ? monthly.rows[0].last_date : null,
      months,
      transactions: rows.map(toTransaction),
      nextCursor: hasMore ? encodeCursor(sort, rows.at(-1)) : null,
    },
  };
}

export const historyRoutes = [{ method: 'GET', path: '/api/category-history', handler: history }];
