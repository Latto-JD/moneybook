-- 멱등 스키마: 여러 번 실행해도 안전하다. (npm run db:migrate)

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (char_length(email) between 3 and 254),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_id_idx on sessions (user_id);

create table if not exists auth_attempts (
  id bigserial primary key,
  kind text not null check (kind in ('login', 'signup')),
  email text,
  ip text not null default '',
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_email_idx on auth_attempts (kind, email, created_at);
create index if not exists auth_attempts_ip_idx on auth_attempts (kind, ip, created_at);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  amount integer not null check (amount between 1 and 100000000),
  category text not null,
  memo text not null default '' check (char_length(memo) <= 50),
  date date not null,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on transactions (user_id, date);

-- 사용자별 카테고리 (v3). 거래(transactions.category)는 계속 이름 문자열이고, 이 테이블은 선택 가능한 목록과 상태만 관리한다.
-- 추가 전용: 기존 테이블은 건드리지 않아 구버전 코드와 호환된다.
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  name text not null check (char_length(name) between 1 and 15),
  name_key text not null,
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, type, name_key)
);
create index if not exists categories_user_type_sort_idx on categories (user_id, type, sort_order);

-- 기본 세트: 카테고리 행이 하나도 없는 사용자에게만 넣는다. (재실행해도 사용자가 바꾼 이름·상태를 되살리지 않는다)
-- 목록은 src/backend/lib/categories.js 의 DEFAULT_CATEGORIES 와 같아야 한다 (db.test.js 가 확인).
insert into categories (user_id, type, name, name_key, sort_order)
select u.id, d.type, d.name, lower(d.name), d.ord
  from users u
 cross join (values
   ('expense', '식비', 0), ('expense', '카페/간식', 1), ('expense', '교통', 2), ('expense', '쇼핑', 3),
   ('expense', '주거/통신', 4), ('expense', '의료/건강', 5), ('expense', '문화/여가', 6), ('expense', '기타', 7),
   ('income', '급여', 0), ('income', '용돈', 1), ('income', '부수입', 2), ('income', '기타', 3)
 ) as d(type, name, ord)
 where not exists (select 1 from categories c where c.user_id = u.id)
on conflict do nothing;

-- 방어용: 거래에는 있는데 카테고리 목록에 없는 (사용자, 유형, 이름)을 사용 안 함 행으로 만든다.
-- 15자 초과이거나 이름 키가 이미 있으면 건너뛴다. 정상 데이터에서는 0건이다.
insert into categories (user_id, type, name, name_key, active, sort_order)
select x.user_id, x.type, x.category, x.key, false,
       coalesce((select max(c.sort_order) from categories c where c.user_id = x.user_id and c.type = x.type), -1)
         + row_number() over (partition by x.user_id, x.type order by x.key, x.category)
  from (
    select distinct on (user_id, type, lower(category)) user_id, type, category, lower(category) as key
      from transactions
     where char_length(category) between 1 and 15
     order by user_id, type, lower(category), category
  ) x
 where not exists (
   select 1 from categories c where c.user_id = x.user_id and c.type = x.type and c.name_key = x.key
 )
on conflict do nothing;
