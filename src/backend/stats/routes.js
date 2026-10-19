import { categoryOrder } from '../lib/categories.js';
import { monthsBetween, monthStart, nextMonthStart } from '../lib/dates.js';
import { parseRange, parseType, requireMonth } from '../lib/params.js';

const round4 = (x) => Math.round(x * 10000) / 10000;

// from~to 범위의 (월, 구분)별 합계/건수
async function monthlyRows(db, userId, from, to) {
  const { rows } = await db.query(
    `select to_char(date, 'YYYY-MM') as month, type, sum(amount)::bigint as total, count(*)::bigint as n
       from transactions
      where user_id = $1 and date >= $2::date and date < $3::date
      group by 1, 2`,
    [userId, monthStart(from), nextMonthStart(to)],
  );
  return rows;
}

function buildMonths(rows, from, to) {
  const map = new Map(
    monthsBetween(from, to).map((m) => [m, { month: m, incomeTotal: 0, expenseTotal: 0, balance: 0, count: 0 }]),
  );
  for (const r of rows) {
    const e = map.get(r.month);
    if (!e) continue;
    if (r.type === 'income') e.incomeTotal += Number(r.total);
    else e.expenseTotal += Number(r.total);
    e.count += Number(r.n);
  }
  for (const e of map.values()) e.balance = e.incomeTotal - e.expenseTotal;
  return [...map.values()];
}

async function categoryRows(db, userId, from, to, type) {
  const { rows } = await db.query(
    `select category, sum(amount)::bigint as total, count(*)::bigint as n
       from transactions
      where user_id = $1 and type = $2 and date >= $3::date and date < $4::date
      group by category`,
    [userId, type, monthStart(from), nextMonthStart(to)],
  );
  return rows
    .map((r) => ({ category: r.category, total: Number(r.total), count: Number(r.n) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || categoryOrder(type, a.category) - categoryOrder(type, b.category));
}

function withRatio(items) {
  const grandTotal = items.reduce((s, i) => s + i.total, 0);
  return {
    grandTotal,
    items: items.map((i) => ({ ...i, ratio: grandTotal ? round4(i.total / grandTotal) : 0 })),
  };
}

async function summary({ db, user, query }) {
  const month = requireMonth(query.month);
  const [rows, cats] = await Promise.all([
    monthlyRows(db, user.id, month, month),
    categoryRows(db, user.id, month, month, 'expense'),
  ]);
  const m = buildMonths(rows, month, month)[0];
  const { items } = withRatio(cats);
  return {
    status: 200,
    body: { month, incomeTotal: m.incomeTotal, expenseTotal: m.expenseTotal, balance: m.balance, byCategory: items },
  };
}

async function monthly({ db, user, query }) {
  const { from, to } = parseRange(query);
  parseType(query.type); // monthly 는 type 을 쓰지 않지만 잘못된 값은 400
  const rows = await monthlyRows(db, user.id, from, to);
  return { status: 200, body: { from, to, months: buildMonths(rows, from, to) } };
}

async function categories({ db, user, query }) {
  const { from, to } = parseRange(query);
  const type = parseType(query.type);
  const { grandTotal, items } = withRatio(await categoryRows(db, user.id, from, to, type));
  return { status: 200, body: { from, to, type, grandTotal, items } };
}

async function categoryMonthly({ db, user, query }) {
  const { from, to } = parseRange(query);
  const type = parseType(query.type);
  const months = monthsBetween(from, to);
  const { rows } = await db.query(
    `select to_char(date, 'YYYY-MM') as month, category, sum(amount)::bigint as total
       from transactions
      where user_id = $1 and type = $2 and date >= $3::date and date < $4::date
      group by 1, 2`,
    [user.id, type, monthStart(from), nextMonthStart(to)],
  );
  const byCat = new Map();
  for (const r of rows) {
    const idx = months.indexOf(r.month);
    if (idx < 0) continue;
    if (!byCat.has(r.category)) byCat.set(r.category, new Array(months.length).fill(0));
    byCat.get(r.category)[idx] += Number(r.total);
  }
  const series = [...byCat.entries()]
    .map(([category, totals]) => ({ category, totals, sum: totals.reduce((a, b) => a + b, 0) }))
    .filter((s) => s.sum > 0)
    .sort((a, b) => b.sum - a.sum || categoryOrder(type, a.category) - categoryOrder(type, b.category));
  return { status: 200, body: { from, to, type, months, series } };
}

export const statsRoutes = [
  { method: 'GET', path: '/api/summary', handler: summary },
  { method: 'GET', path: '/api/stats/monthly', handler: monthly },
  { method: 'GET', path: '/api/stats/categories', handler: categories },
  { method: 'GET', path: '/api/stats/category-monthly', handler: categoryMonthly },
];
