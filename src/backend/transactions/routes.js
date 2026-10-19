import { ApiError } from '../http.js';
import { CATEGORIES, TYPES } from '../lib/categories.js';
import { isValidDateStr, nextMonthStart, monthStart } from '../lib/dates.js';
import { requireMonth } from '../lib/params.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id, type, amount, category, memo, date, created_at';

export function toTransaction(row) {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    category: row.category,
    memo: row.memo,
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : row.date.toISOString().slice(0, 10),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}

// 거래 입력 검증. userId/id/createdAt 등 알 수 없는 필드는 무시한다.
export function validateTransactionInput(body) {
  const fields = {};
  const { type, amount, category, date } = body;
  let memo = body.memo;

  if (!TYPES.includes(type)) fields.type = 'type 은 expense 또는 income 이어야 해요.';
  if (!(typeof amount === 'number' && Number.isInteger(amount) && amount >= 1 && amount <= 100_000_000)) {
    fields.amount = '금액은 1 이상 100000000 이하의 정수여야 해요.';
  }
  if (!fields.type && !(typeof category === 'string' && CATEGORIES[type].includes(category))) {
    fields.category = '해당 구분에 없는 카테고리예요.';
  } else if (fields.type && typeof category !== 'string') {
    fields.category = '카테고리를 선택해 주세요.';
  }
  if (!isValidDateStr(date)) fields.date = '날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 해요.';
  if (memo === undefined || memo === null) memo = '';
  if (typeof memo !== 'string') fields.memo = '메모는 문자열이어야 해요.';
  else {
    memo = memo.trim();
    if ([...memo].length > 50) fields.memo = '메모는 50자 이하여야 해요.';
  }

  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  }
  return { type, amount, category, memo, date };
}

const notFound = () => new ApiError(404, 'NOT_FOUND', '거래를 찾을 수 없어요.');

async function list({ db, user, query }) {
  const month = requireMonth(query.month);
  const { rows } = await db.query(
    `select ${COLUMNS} from transactions
      where user_id = $1 and date >= $2::date and date < $3::date
      order by date desc, created_at desc, id desc`,
    [user.id, monthStart(month), nextMonthStart(month)],
  );
  return { status: 200, body: { month, transactions: rows.map(toTransaction) } };
}

async function create({ db, user, body }) {
  const t = validateTransactionInput(body);
  const { rows } = await db.query(
    `insert into transactions (user_id, type, amount, category, memo, date)
     values ($1, $2, $3, $4, $5, $6::date) returning ${COLUMNS}`,
    [user.id, t.type, t.amount, t.category, t.memo, t.date],
  );
  return { status: 201, body: toTransaction(rows[0]) };
}

async function update({ db, user, params, body }) {
  if (!UUID_RE.test(params.id)) throw notFound();
  const t = validateTransactionInput(body);
  const { rows } = await db.query(
    `update transactions set type = $3, amount = $4, category = $5, memo = $6, date = $7::date
      where id = $1 and user_id = $2 returning ${COLUMNS}`,
    [params.id, user.id, t.type, t.amount, t.category, t.memo, t.date],
  );
  if (!rows[0]) throw notFound();
  return { status: 200, body: toTransaction(rows[0]) };
}

async function remove({ db, user, params }) {
  if (!UUID_RE.test(params.id)) throw notFound();
  const { rowCount } = await db.query('delete from transactions where id = $1 and user_id = $2', [params.id, user.id]);
  if (!rowCount) throw notFound();
  return { status: 204 };
}

async function categories() {
  return { status: 200, body: CATEGORIES };
}

export const transactionRoutes = [
  { method: 'GET', path: '/api/categories', handler: categories },
  { method: 'GET', path: '/api/transactions', handler: list },
  { method: 'POST', path: '/api/transactions', handler: create },
  { method: 'PUT', path: '/api/transactions/:id', handler: update },
  { method: 'DELETE', path: '/api/transactions/:id', handler: remove },
];
