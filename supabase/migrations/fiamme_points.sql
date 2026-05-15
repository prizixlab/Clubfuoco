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

-- ── Auto-award trigger ──────────────────────────────────────────────────────
-- Awards Fiamme automatically whenever a booking_surveys row is inserted.
-- Runs inside the database (security definer) so it bypasses RLS and is
-- immune to API-route / serverless / client-auth fragility.
--   +10  every verified review
--   +50  if it's the first review of that club by anyone
create or replace function public.award_fiamme_for_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id     uuid;
  v_prior_count int;
begin
  -- +10 base
  insert into public.fiamme_ledger (user_id, amount, type, description, booking_id)
  values (new.user_id, 10, 'review', 'Verified review', new.booking_id);

  -- +50 first review of this club by anyone
  select club_id into v_club_id from public.bookings where id = new.booking_id;
  if v_club_id is not null then
    select count(*) into v_prior_count
    from public.booking_surveys bs
    join public.bookings b on b.id = bs.booking_id
    where b.club_id = v_club_id and bs.id <> new.id;

    if v_prior_count = 0 then
      insert into public.fiamme_ledger (user_id, amount, type, description, booking_id)
      values (new.user_id, 50, 'first_review', 'First review at this venue', new.booking_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_award_fiamme_for_review on public.booking_surveys;
create trigger trg_award_fiamme_for_review
  after insert on public.booking_surveys
  for each row
  execute function public.award_fiamme_for_review();
