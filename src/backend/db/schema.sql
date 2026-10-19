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
