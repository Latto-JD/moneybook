// 시드 스크립트: npm run seed -- --email=a@ex.com --password=... --today=2026-10-19 [--reset] [--yes]
// 사용자가 없으면 만들고, 그 사용자에게만 최근 7개월(today 의 달 포함) 데이터를 넣는다.
// PGlite 가 아닌 DB 대상이면 --yes 없이는 실행하지 않는다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { hashPassword } from '../auth/password.js';
import { isValidEmail, isValidPassword, normalizeEmail } from '../auth/validate.js';
import { ensureDefaults } from '../lib/categories.js';
import { addDays, addMonths, isValidDateStr, todayInSeoul } from '../lib/dates.js';

const pad = (n) => String(n).padStart(2, '0');

// R1~R5 가 모두 나오고 최근 6개월 모든 달에 지출이 있도록 구성한 거래 목록 (순수 함수)
export function buildSeedTransactions(today) {
  const out = [];
  const add = (type, amount, category, memo, date) => {
    if (date <= today) out.push({ type, amount, category, memo, date });
  };
  const cur = today.slice(0, 7);
  const todayDay = Number(today.slice(8, 10));

  // 교통: 서로 다른 날짜의 비반복 소비(R3 에 감지되지 않음). 과거 달 월 60,000원(baseline),
  // 이번 달은 2건 50,000원 -> exceeded 는 아니지만 today 가 7일 이후면 비반복 페이스(pace)로 잡힌다.
  const taxiDays = [4, 20, 9, 27, 12, 2];
  const busDays = [18, 6, 23, 3, 25, 14];

  for (let i = -6; i <= 0; i++) {
    const m = addMonths(cur, i);
    if (i < 0) {
      add('expense', 30_000, '교통', '택시', `${m}-${pad(taxiDays[i + 6])}`);
      add('expense', 30_000, '교통', '버스', `${m}-${pad(busDays[i + 6])}`);
    } else {
      add('expense', 25_000, '교통', '택시', `${m}-06`);
      add('expense', 25_000, '교통', '버스', `${m}-09`);
    }
    add('income', 2_800_000, '급여', '월급', `${m}-25`);
    add('expense', 500_000, '주거/통신', '월세', `${m}-05`); // R3 월간
    add('expense', 17_000, '문화/여가', '넷플릭스', `${m}-12`); // R3 월간
    const memos = ['점심 식사', '저녁 식사', '편의점', '배달 음식'];
    if (i < 0) {
      // 과거 달 식비: 월 300,000원 (R4 baseline)
      for (let k = 0; k < 10; k++) add('expense', 30_000, '식비', memos[k % 4], `${m}-${pad(1 + k * 3)}`);
    } else {
      // 이번 달 식비: 420,000원 (baseline 의 1.4배 -> exceeded). 오늘 이전 날짜에만 배치
      for (let k = 0; k < 14; k++) add('expense', 30_000, '식비', memos[k % 4], `${m}-${pad((k % todayDay) + 1)}`);
    }
  }

  // R1(자주 쓰는 항목, 오늘 요일 일치) + R3 주간: 매주 같은 요일 스타벅스
  for (let k = 0; k < 12; k++) add('expense', 4_500, '카페/간식', '스타벅스', addDays(today, -7 * k));

  // R5: 쇼핑 비교군 6건(중앙값 40,000원) + 오늘 250,000원
  [40_000, 35_000, 45_000, 40_000, 38_000, 42_000].forEach((amount, k) =>
    add('expense', amount, '쇼핑', '생활용품', addDays(today, -(12 + 10 * k))),
  );
  add('expense', 250_000, '쇼핑', '패딩', today);
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

export async function seed(db, { email, password, today, reset = false }) {
  const normalized = normalizeEmail(email);
  let { rows } = await db.query('select id from users where email = $1', [normalized]);
  let userId = rows[0]?.id;
  let created = false;
  if (!userId) {
    ({ rows } = await db.query('insert into users (email, password_hash) values ($1, $2) returning id', [
      normalized,
      await hashPassword(password),
    ]));
    userId = rows[0].id;
    created = true;
  } else {
    const { rows: c } = await db.query('select count(*)::int as n from transactions where user_id = $1', [userId]);
    if (c[0].n > 0) {
      if (!reset) throw new Error('이미 거래가 있는 사용자예요. 이 사용자의 거래를 지우고 다시 넣으려면 --reset 을 붙이세요.');
      await db.query('delete from transactions where user_id = $1', [userId]);
    }
  }
  await ensureDefaults(db, userId); // 거래 카테고리가 기본 세트이므로 사용자에게 기본 세트가 있어야 한다
  const txs = buildSeedTransactions(today);
  await db.transaction(async (tx) => {
    for (const t of txs) {
      await tx.query(
        'insert into transactions (user_id, type, amount, category, memo, date) values ($1, $2, $3, $4, $5, $6::date)',
        [userId, t.type, t.amount, t.category, t.memo, t.date],
      );
    }
  });
  return { userId, created, count: txs.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fail = (msg) => {
    console.error(`시드 실패: ${msg}`);
    console.error('사용법: npm run seed -- --email=<이메일> --password=<비밀번호> [--today=YYYY-MM-DD] [--reset] [--yes]');
    process.exitCode = 1;
  };
  if (typeof args.email !== 'string' || !isValidEmail(normalizeEmail(args.email))) return fail('--email 이 올바르지 않아요.');
  if (typeof args.password !== 'string' || !isValidPassword(args.password)) return fail('--password 는 8~128자여야 해요.');
  const today = args.today === undefined ? todayInSeoul() : args.today;
  if (!isValidDateStr(today)) return fail('--today 는 YYYY-MM-DD 형식이어야 해요.');

  const isPglite = process.env.DB_DRIVER === 'pglite';
  if (!isPglite && args.yes !== true) {
    return fail('PGlite 가 아닌 DB 에는 --yes 없이 실행할 수 없어요. 대상 DB 를 확인한 뒤 --yes 를 붙이세요.');
  }
  let db;
  try {
    db = await createDb(process.env, { forMigration: true });
    await migrate(db);
    const r = await seed(db, { email: args.email, password: args.password, today, reset: args.reset === true });
    console.log(
      `시드 완료 (driver=${db.driver}): ${normalizeEmail(args.email)} ${r.created ? '생성' : '기존 사용자'}, 거래 ${r.count}건, today=${today}`,
    );
  } catch (e) {
    fail(e.code || e.message?.replace(/\w+:\/\/\S+/g, '[redacted]') || e.name);
  } finally {
    await db?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
