// 추천/인사이트 API. 규칙 로직은 rules/*.js 의 순수 함수이고, 여기서는 세션 사용자의 거래만 읽어 넘긴다.
import { ApiError } from '../http.js';
import { addDays, addMonths, monthStart, nextMonthStart } from '../lib/dates.js';
import { parseToday, parseType, requireMonth } from '../lib/params.js';
import { toTransaction } from '../transactions/routes.js';
import { quickSuggestions, QUICK } from './quick.js';
import { autocomplete, AUTOCOMPLETE } from './autocomplete.js';
import { detectRecurringGroups, RECURRING } from './recurring.js';
import { detectOverspending, OVERSPENDING } from './overspending.js';
import { detectLargeExpenses, LARGE } from './large.js';
import { detectIncomeDrops, detectMissingIncome, INCOME_DROP } from './income.js';
import { memoKey } from './common.js';
import { loadActiveNames, loadOrderFn } from '../lib/categories.js';

const COLUMNS = 'id, type, amount, category, memo, date, created_at';

// 세션 사용자의 거래 중 [from, to] (양 끝 포함) 구간. type 이 있으면 해당 구분만
async function loadTransactions(db, userId, from, to, type) {
  const params = [userId, from, to];
  let sql = `select ${COLUMNS} from transactions where user_id = $1 and date >= $2::date and date <= $3::date`;
  if (type) {
    params.push(type);
    sql += ' and type = $4';
  }
  const { rows } = await db.query(sql, params);
  return rows.map(toTransaction);
}

async function quick({ db, user, query, now }) {
  const type = parseType(query.type);
  const today = parseToday(query.today, now);
  const txs = await loadTransactions(db, user.id, addDays(today, -(QUICK.windowDays - 1)), today, type);
  const active = await loadActiveNames(db, user.id, type);
  return { status: 200, body: { items: quickSuggestions(txs, type, today, active) } };
}

async function autocompleteRoute({ db, user, query, now }) {
  const type = parseType(query.type);
  const today = parseToday(query.today, now);
  const q = query.q ?? '';
  if ([...memoKey(q)].length > AUTOCOMPLETE.maxQueryLength) {
    const msg = `q 는 ${AUTOCOMPLETE.maxQueryLength}자 이하여야 해요.`;
    throw new ApiError(400, 'VALIDATION_ERROR', msg, { fields: { q: msg } });
  }
  if (!memoKey(q)) return { status: 200, body: { items: [] } };
  const txs = await loadTransactions(db, user.id, addDays(today, -(AUTOCOMPLETE.windowDays - 1)), today, type);
  const active = await loadActiveNames(db, user.id, type);
  return { status: 200, body: { items: autocomplete(txs, q, type, today, active) } };
}

// insights 가 읽는 가장 이른 날짜: 규칙별 필요 구간 중 가장 이른 날
export function insightsFrom(month, today) {
  return [
    addDays(today, -(RECURRING.windowDays - 1)),
    addDays(monthStart(month), -LARGE.windowDays),
    monthStart(addMonths(month, -OVERSPENDING.baselineMonths)),
    monthStart(addMonths(month, -INCOME_DROP.baselineMonths)),
  ].sort()[0];
}

async function insights({ db, user, query, now }) {
  const month = requireMonth(query.month);
  const today = parseToday(query.today, now);
  const from = insightsFrom(month, today); // 각 규칙이 필요로 하는 가장 이른 날짜부터
  const monthEnd = addDays(nextMonthStart(month), -1);
  const to = monthEnd > today ? monthEnd : today;
  const txs = await loadTransactions(db, user.id, from, to);
  const groups = detectRecurringGroups(txs, today);
  const orderOf = await loadOrderFn(db, user.id);
  return {
    status: 200,
    body: {
      month,
      recurring: groups.map((g) => g.item),
      overspending: detectOverspending(txs, month, today, new Set(groups.map((g) => g.key)), orderOf),
      largeExpenses: detectLargeExpenses(txs, month),
      incomeDrops: detectIncomeDrops(txs, month, today, orderOf),
      missingIncome: detectMissingIncome(txs, month, today),
    },
  };
}

export const ruleRoutes = [
  { method: 'GET', path: '/api/recommendations/quick', handler: quick },
  { method: 'GET', path: '/api/recommendations/autocomplete', handler: autocompleteRoute },
  { method: 'GET', path: '/api/insights', handler: insights },
];
