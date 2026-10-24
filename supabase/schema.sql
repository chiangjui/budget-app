-- 零用錢管家：資料庫結構
-- 在 Supabase 後台 → SQL Editor → 貼上整份 → Run

-- 個人設定（每位使用者一筆）
create table if not exists settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  opening_balance numeric(12,2) not null default 0,  -- 開始使用時手上的錢
  start_date date not null default current_date,
  allowance_5 numeric(12,2) not null default 0,      -- 每月 5 號零用錢
  allowance_20 numeric(12,2) not null default 0,     -- 每月 20 號零用錢
  reserve numeric(12,2) not null default 0,          -- 安全墊（永遠不動用的錢）
  generated_through date                             -- 零用錢已自動入帳到哪一天
);

-- 先用後付的付款方式（信用卡、先享後付…）
create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  closing_day int check (closing_day between 1 and 31),  -- 結帳日（空白 = 每筆自己填繳款日）
  due_day int check (due_day between 1 and 31),          -- 繳款日
  created_at timestamptz not null default now(),
  constraint payment_methods_schedule_both check ((closing_day is null) = (due_day is null))
);

-- 先用後付的消費（可分期）
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  method_id uuid not null references payment_methods on delete cascade,
  date date not null,
  amount numeric(12,2) not null check (amount > 0),
  installments int not null default 1 check (installments between 1 and 60),
  due_date date,               -- 自己指定的（第一期）繳款日；空白 = 照結帳日算
  category text,
  note text,
  created_at timestamptz not null default now()
);

-- 固定支出（手機費、訂閱…）
create table if not exists recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount > 0),
  day int not null check (day between 1 and 31),
  start_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 實際的金流：收入、即時支出、還款
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  kind text not null check (kind in ('income', 'expense', 'repayment')),
  amount numeric(12,2) not null,
  category text,
  note text,
  source text,                 -- 'allowance' = 自動入帳的零用錢
  method_id uuid references payment_methods on delete set null,
  bill_due date,               -- 還款：還的是哪一天到期的帳單
  recurring_id uuid references recurring on delete set null,
  recurring_date date,         -- 固定支出：付的是哪一期
  created_at timestamptz not null default now()
);

-- 同一天的零用錢只會自動入帳一次
create unique index if not exists transactions_allowance_once
  on transactions (user_id, date) where source = 'allowance';

-- 資料列安全性：每個人只能看到、修改自己的資料
alter table settings enable row level security;
alter table payment_methods enable row level security;
alter table purchases enable row level security;
alter table recurring enable row level security;
alter table transactions enable row level security;

create policy "own settings" on settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own payment_methods" on payment_methods for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own purchases" on purchases for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own recurring" on recurring for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions" on transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
