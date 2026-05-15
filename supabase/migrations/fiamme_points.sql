-- Fiamme points ledger
-- Each row is a credit (+) or debit (−) event. Balance = SUM(amount) per user.
-- No foreign keys: a FK to public.bookings caused the CREATE TABLE to roll
-- back on environments where the referenced column type didn't match.

create table if not exists public.fiamme_ledger (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  amount      int         not null,                 -- positive = earn, negative = spend
  type        text        not null,                 -- 'review' | 'photo' | 'first_review' | 'streak' | 'welcome' | 'redemption'
  description text,
  booking_id  uuid,
  created_at  timestamptz not null default now()
);

alter table public.fiamme_ledger enable row level security;

drop policy if exists "Users can read own ledger"   on public.fiamme_ledger;
drop policy if exists "Users can insert own ledger" on public.fiamme_ledger;

create policy "Users can read own ledger"
  on public.fiamme_ledger for select
  using (auth.uid() = user_id);

create policy "Users can insert own ledger"
  on public.fiamme_ledger for insert
  with check (auth.uid() = user_id);

create index if not exists idx_fiamme_ledger_user
  on public.fiamme_ledger (user_id, created_at desc);

-- One-use redemption codes (24-hour TTL)
create table if not exists public.fiamme_redemptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  code        text        not null unique,
  reward_key  text        not null,
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.fiamme_redemptions enable row level security;

drop policy if exists "Users can read own redemptions"   on public.fiamme_redemptions;
drop policy if exists "Users can insert own redemptions" on public.fiamme_redemptions;

create policy "Users can read own redemptions"
  on public.fiamme_redemptions for select
  using (auth.uid() = user_id);

create policy "Users can insert own redemptions"
  on public.fiamme_redemptions for insert
  with check (auth.uid() = user_id);

create index if not exists idx_fiamme_redemptions_user
  on public.fiamme_redemptions (user_id, created_at desc);
