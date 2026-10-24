-- 新功能：自己填繳款日
-- 已經用 schema.sql 建好資料庫的人，在 Supabase → SQL Editor 貼上這份並 Run（跑一次就好）

-- 每筆先用後付可以自己指定（第一期的）繳款日；空白 = 照付款方式的結帳日算
alter table purchases add column if not exists due_date date;

-- 付款方式可以沒有結帳日／繳款日（每筆自己填）
alter table payment_methods alter column closing_day drop not null;
alter table payment_methods alter column due_day drop not null;
alter table payment_methods drop constraint if exists payment_methods_schedule_both;
alter table payment_methods add constraint payment_methods_schedule_both
  check ((closing_day is null) = (due_day is null));
