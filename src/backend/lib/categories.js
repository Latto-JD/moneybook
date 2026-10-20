// 카테고리: 기본 세트, 이름 규칙, 사용자별 조회 헬퍼. 거래는 카테고리를 이름 문자열로 저장한다.
import { koCompare } from '../rules/common.js';

// 가입(또는 마이그레이션) 시 사용자 행으로 복사되는 기본 세트. 배열 순서가 sort_order 이다.
// schema.sql 의 기본 세트 INSERT 와 같아야 한다.
export const DEFAULT_CATEGORIES = {
  expense: ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'],
  income: ['급여', '용돈', '부수입', '기타'],
};

export const TYPES = ['expense', 'income'];

export const CATEGORY_LIMITS = { activePerType: 30, total: 120, nameMax: 15 };

export const TYPE_LABEL = { expense: '지출', income: '수입' };

// 기본 세트 순서 인덱스 (목록에 없으면 맨 뒤). 사용자 카테고리를 모르는 순수 함수의 기본 동률 기준이다.
export function categoryOrder(type, category) {
  const i = DEFAULT_CATEGORIES[type]?.indexOf(category) ?? -1;
  return i < 0 ? 999 : i;
}

// 이름 정규화: NFC, 앞뒤 공백 제거, 연속 공백(탭·줄바꿈 포함) 1칸. 문제가 있으면 { error } 를 돌려준다.
export function normalizeCategoryName(raw) {
  const lengthMsg = `카테고리 이름은 1자 이상 ${CATEGORY_LIMITS.nameMax}자 이하여야 해요.`;
  if (typeof raw !== 'string') return { error: '카테고리 이름을 입력해 주세요.' };
  // 제어문자는 공백 정규화 전에 검사한다 (탭·줄바꿈은 공백으로 취급하므로 제외)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
    return { error: '카테고리 이름에 쓸 수 없는 문자가 있어요.' };
  }
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const len = [...name].length;
  if (len < 1 || len > CATEGORY_LIMITS.nameMax) return { error: lengthMsg };
  return { name, key: name.toLowerCase() };
}

export function toCategory(row, usedCount = 0) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    active: row.active,
    sortOrder: Number(row.sort_order),
    usedCount: Number(usedCount),
  };
}

// 행이 하나도 없는 사용자에게만 기본 세트를 넣는다. 동시 호출은 unique 제약 + on conflict 로 12행에 수렴한다.
// db 는 어댑터 또는 트랜잭션 핸들(query 만 사용).
export async function ensureDefaults(db, userId) {
  const types = [];
  const names = [];
  const orders = [];
  for (const type of TYPES) {
    DEFAULT_CATEGORIES[type].forEach((name, i) => {
      types.push(type);
      names.push(name);
      orders.push(i);
    });
  }
  await db.query(
    `insert into categories (user_id, type, name, name_key, sort_order)
     select $1::uuid, d.type, d.name, lower(d.name), d.ord
       from unnest($2::text[], $3::text[], $4::int[]) as d(type, name, ord)
      where not exists (select 1 from categories c where c.user_id = $1::uuid)
     on conflict do nothing`,
    [userId, types, names, orders],
  );
}

const byOrder = (a, b) => a.sort_order - b.sort_order || koCompare(a.name, b.name);

// 사용자의 카테고리 행 전체 (지출 먼저, 유형 안에서 sortOrder 순). 행이 0개면 기본 세트를 만든다.
export async function loadUserCategories(db, userId) {
  const select = () => db.query('select id, type, name, active, sort_order from categories where user_id = $1', [userId]);
  let { rows } = await select();
  if (!rows.length) {
    await ensureDefaults(db, userId);
    ({ rows } = await select());
  }
  return TYPES.flatMap((type) => rows.filter((r) => r.type === type).sort(byOrder));
}

// 유형·이름별 거래 건수 Map ('type\0name' -> n)
export async function usedCounts(db, userId) {
  const { rows } = await db.query(
    'select type, category, count(*)::int as n from transactions where user_id = $1 group by type, category',
    [userId],
  );
  return new Map(rows.map((r) => [`${r.type}\u0000${r.category}`, Number(r.n)]));
}

export const usedKey = (type, name) => `${type}\u0000${name}`;

// 정렬 동률 기준: (type, category) -> sortOrder. 비활성 포함, 목록에 없으면 맨 뒤.
export async function loadOrderFn(db, userId) {
  const rows = await loadUserCategories(db, userId);
  const map = new Map(rows.map((r) => [usedKey(r.type, r.name), Number(r.sort_order)]));
  return (type, category) => map.get(usedKey(type, category)) ?? Number.MAX_SAFE_INTEGER;
}

// 활성 이름 Set (type 별)
export async function loadActiveNames(db, userId, type) {
  const rows = await loadUserCategories(db, userId);
  return new Set(rows.filter((r) => r.type === type && r.active).map((r) => r.name));
}
