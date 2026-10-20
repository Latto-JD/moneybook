// 카테고리 관리 API (v3). 거래는 이름 문자열을 저장하므로 이름 변경은 같은 트랜잭션에서 과거 거래도 함께 바꾼다.
import { ApiError } from '../http.js';
import {
  CATEGORY_LIMITS,
  TYPES,
  TYPE_LABEL,
  ensureDefaults,
  loadUserCategories,
  normalizeCategoryName,
  toCategory,
  usedCounts,
  usedKey,
} from '../lib/categories.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW = 'id, type, name, name_key, active, sort_order';

const validation = (field, message) => new ApiError(400, 'VALIDATION_ERROR', message, { fields: { [field]: message } });
const notFound = () => new ApiError(404, 'NOT_FOUND', '카테고리를 찾을 수 없어요.');
const exists = () => new ApiError(409, 'CATEGORY_EXISTS', '이미 같은 이름의 카테고리가 있어요.');

// 같은 사용자의 카테고리 쓰기를 직렬화한다. FOR NO KEY UPDATE 는 거래 INSERT 의 FK 확인(FOR KEY SHARE)과 충돌하지 않는다.
async function lockUser(tx, userId) {
  await tx.query('select id from users where id = $1 for no key update', [userId]);
}

async function usedCountOf(db, userId, type, name) {
  const { rows } = await db.query(
    'select count(*)::int as n from transactions where user_id = $1 and type = $2 and category = $3',
    [userId, type, name],
  );
  return rows[0].n;
}

async function list({ db, user }) {
  const [rows, counts] = await Promise.all([loadUserCategories(db, user.id), usedCounts(db, user.id)]);
  const items = rows.map((r) => toCategory(r, counts.get(usedKey(r.type, r.name)) ?? 0));
  const names = (type) => items.filter((i) => i.type === type && i.active).map((i) => i.name);
  return { status: 200, body: { expense: names('expense'), income: names('income'), items } };
}

async function create({ db, user, body }) {
  const fields = {};
  if (!TYPES.includes(body.type)) fields.type = 'type 은 expense 또는 income 이어야 해요.';
  const n = normalizeCategoryName(body.name);
  if (n.error) fields.name = n.error;
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  }
  const { type } = body;

  const created = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    await ensureDefaults(tx, user.id);
    const { rows: same } = await tx.query(
      'select id, active from categories where user_id = $1 and type = $2 and name_key = $3',
      [user.id, type, n.key],
    );
    if (same[0]) {
      if (same[0].active) throw exists();
      throw new ApiError(409, 'CATEGORY_INACTIVE', '같은 이름의 사용 안 함 카테고리가 있어요.', {
        categoryId: same[0].id,
      });
    }
    const { rows: stat } = await tx.query(
      `select count(*) filter (where type = $2 and active)::int as active_in_type,
              count(*)::int as total,
              coalesce(max(sort_order) filter (where type = $2), -1)::int as max_sort
         from categories where user_id = $1`,
      [user.id, type],
    );
    const s = stat[0];
    if (s.active_in_type >= CATEGORY_LIMITS.activePerType) {
      throw new ApiError(
        409,
        'CATEGORY_LIMIT',
        `${TYPE_LABEL[type]} 카테고리는 사용 중인 것이 ${CATEGORY_LIMITS.activePerType}개까지예요.`,
      );
    }
    if (s.total >= CATEGORY_LIMITS.total) {
      throw new ApiError(409, 'CATEGORY_LIMIT', `카테고리는 모두 합쳐 ${CATEGORY_LIMITS.total}개까지 만들 수 있어요.`);
    }
    const { rows } = await tx.query(
      `insert into categories (user_id, type, name, name_key, sort_order) values ($1, $2, $3, $4, $5)
       returning ${ROW}`,
      [user.id, type, n.name, n.key, s.max_sort + 1],
    );
    return rows[0];
  });
  return { status: 201, body: toCategory(created, await usedCountOf(db, user.id, created.type, created.name)) };
}

async function patch({ db, user, params, body }) {
  const hasName = body.name !== undefined;
  const hasActive = body.active !== undefined;
  if (!hasName && !hasActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name 또는 active 중 하나는 보내 주세요.');
  }
  const fields = {};
  let n;
  if (hasName) {
    n = normalizeCategoryName(body.name);
    if (n.error) fields.name = n.error;
  }
  if (hasActive && typeof body.active !== 'boolean') fields.active = 'active 는 true 또는 false 여야 해요.';
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  }
  if (!UUID_RE.test(params.id)) throw notFound();

  const updated = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    const { rows } = await tx.query(`select ${ROW} from categories where id = $1 and user_id = $2 for update`, [
      params.id,
      user.id,
    ]);
    let cur = rows[0];
    if (!cur) throw notFound();

    if (hasName && n.name !== cur.name) {
      const { rows: clash } = await tx.query(
        'select 1 from categories where user_id = $1 and type = $2 and name_key = $3 and id <> $4',
        [user.id, cur.type, n.key, cur.id],
      );
      if (clash[0]) throw exists();
      ({ rows: [cur] } = await tx.query(
        `update categories set name = $2, name_key = $3, updated_at = now() where id = $1 returning ${ROW}`,
        [cur.id, n.name, n.key],
      ));
      // 같은 사용자·같은 유형·옛 이름의 거래만 바꾼다 (다른 사용자, 다른 유형의 같은 이름은 그대로)
      await tx.query('update transactions set category = $4 where user_id = $1 and type = $2 and category = $3', [
        user.id,
        cur.type,
        rows[0].name,
        n.name,
      ]);
    }

    if (hasActive && body.active !== cur.active) {
      const { rows: c } = await tx.query(
        'select count(*) filter (where active)::int as n from categories where user_id = $1 and type = $2',
        [user.id, cur.type],
      );
      if (!body.active && c[0].n <= 1) {
        throw new ApiError(409, 'CATEGORY_LAST_ACTIVE', '카테고리가 하나는 있어야 해요.');
      }
      if (body.active && c[0].n >= CATEGORY_LIMITS.activePerType) {
        throw new ApiError(
          409,
          'CATEGORY_LIMIT',
          `${TYPE_LABEL[cur.type]} 카테고리는 사용 중인 것이 ${CATEGORY_LIMITS.activePerType}개까지예요.`,
        );
      }
      ({ rows: [cur] } = await tx.query(
        `update categories set active = $2, updated_at = now() where id = $1 returning ${ROW}`,
        [cur.id, body.active],
      ));
    }
    return cur;
  });
  return { status: 200, body: toCategory(updated, await usedCountOf(db, user.id, updated.type, updated.name)) };
}

export const categoryRoutes = [
  { method: 'GET', path: '/api/categories', handler: list },
  { method: 'POST', path: '/api/categories', handler: create },
  { method: 'PATCH', path: '/api/categories/:id', handler: patch },
];
