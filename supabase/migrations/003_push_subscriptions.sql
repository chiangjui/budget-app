-- 新功能：繳款提醒推播
-- 在 Supabase → SQL Editor 貼上這份並 Run（跑一次就好）

-- 每支開啟通知的手機／瀏覽器一筆
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,   -- 推播服務給的網址（每台裝置不同）
  p256dh text not null,            -- 加密用的公鑰
  auth text not null,
  lang text not null default 'zh', -- 通知用中文還是英文
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "own push_subscriptions" on push_subscriptions;
create policy "own push_subscriptions" on push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
