-- Fiamme points ledger
-- Each row is a credit (+) or debit (−) event.
-- Balance = SUM(amount) per user.

create table if not exists public.fiamme_ledger (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  amount      int         not null,                 -- positive = earn, negative = spend
  type        text        not null,                 -- 'review' | 'photo' | 'first_review' | 'streak' | 'welcome' | 'redemption'
  description text,
  booking_id  uuid        references public.bookings(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.fiamme_ledger enable row level security;

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
  user_id     uuid        not null references auth.users(id) on delete cascade,
  code        text        not null unique,
  reward_key  text        not null,
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.fiamme_redemptions enable row level security;

create policy "Users can read own redemptions"
  on public.fiamme_redemptions for select
  using (auth.uid() = user_id);

create policy "Users can insert own redemptions"
  on public.fiamme_redemptions for insert
  with check (auth.uid() = user_id);

create index if not exists idx_fiamme_redemptions_user
  on public.fiamme_redemptions (user_id, created_at desc);
