import { ApiError } from '../http.js';
import { TYPES, ensureDefaults } from '../lib/categories.js';
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

// 거래 입력 형식 검증. userId/id/createdAt 등 알 수 없는 필드는 무시한다.
// category 가 사용자의 활성 카테고리인지는 DB 가 필요하므로 assertCategoryUsable 에서 따로 확인한다.
export function validateTransactionInput(body) {
  const fields = {};
  const { type, amount, category, date } = body;
  let memo = body.memo;

  if (!TYPES.includes(type)) fields.type = 'type 은 expense 또는 income 이어야 해요.';
  if (!(typeof amount === 'number' && Number.isInteger(amount) && amount >= 1 && amount <= 100_000_000)) {
    fields.amount = '금액은 1 이상 100000000 이하의 정수여야 해요.';
  }
  if (!fields.type && typeof category !== 'string') {
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

// 같은 사용자의 카테고리 쓰기(이름 변경 등)와 거래 쓰기를 직렬화한다.
// FOR NO KEY UPDATE 는 거래 INSERT 의 FK 확인(FOR KEY SHARE)과 충돌하지 않는다.
// 이름 변경과 거래 쓰기가 겹쳐도 목록에 없는 옛 이름을 가진 새 거래가 생기지 않는다.
async function lockUser(tx, userId) {
  await tx.query('select id from users where id = $1 for no key update', [userId]);
}

// (type, category) 가 활성 카테고리가 아니면 400 VALIDATION_ERROR
async function assertCategoryUsable(tx, userId, type, category) {
  const find = () =>
    tx.query('select active from categories where user_id = $1 and type = $2 and name = $3', [userId, type, category]);
  let { rows } = await find();
  if (!rows[0]) {
    // 카테고리 행이 아직 없는 사용자라면 기본 세트를 만들고 다시 확인한다
    await ensureDefaults(tx, userId);
    ({ rows } = await find());
  }
  let message;
  if (!rows[0]) message = '해당 구분에 없는 카테고리예요.';
  else if (!rows[0].active) message = '사용 안 함으로 바꾼 카테고리예요. 다른 카테고리를 골라 주세요.';
  if (message) throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { category: message } });
}

async function create({ db, user, body }) {
  const t = validateTransactionInput(body);
  const row = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    await assertCategoryUsable(tx, user.id, t.type, t.category);
    const { rows } = await tx.query(
      `insert into transactions (user_id, type, amount, category, memo, date)
       values ($1, $2, $3, $4, $5, $6::date) returning ${COLUMNS}`,
      [user.id, t.type, t.amount, t.category, t.memo, t.date],
    );
    return rows[0];
  });
  return { status: 201, body: toTransaction(row) };
}

async function update({ db, user, params, body }) {
  if (!UUID_RE.test(params.id)) throw notFound();
  const t = validateTransactionInput(body);
  const row = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    const { rows: cur } = await tx.query('select type, category from transactions where id = $1 and user_id = $2', [
      params.id,
      user.id,
    ]);
    if (!cur[0]) throw notFound();
    // 거래의 현재 (type, category) 를 그대로 두는 수정은 사용 안 함 카테고리여도 허용한다
    if (!(cur[0].type === t.type && cur[0].category === t.category)) {
      await assertCategoryUsable(tx, user.id, t.type, t.category);
    }
    const { rows } = await tx.query(
      `update transactions set type = $3, amount = $4, category = $5, memo = $6, date = $7::date
        where id = $1 and user_id = $2 returning ${COLUMNS}`,
      [params.id, user.id, t.type, t.amount, t.category, t.memo, t.date],
    );
    return rows[0];
  });
  return { status: 200, body: toTransaction(row) };
}

async function remove({ db, user, params }) {
  if (!UUID_RE.test(params.id)) throw notFound();
  const { rowCount } = await db.query('delete from transactions where id = $1 and user_id = $2', [params.id, user.id]);
  if (!rowCount) throw notFound();
  return { status: 204 };
}

export const transactionRoutes = [
  { method: 'GET', path: '/api/transactions', handler: list },
  { method: 'POST', path: '/api/transactions', handler: create },
  { method: 'PUT', path: '/api/transactions/:id', handler: update },
  { method: 'DELETE', path: '/api/transactions/:id', handler: remove },
];
