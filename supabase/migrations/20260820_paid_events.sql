-- Paid events — promoters charge for a spot, Stripe pays them directly.
--
-- Apply MANUALLY in the Supabase SQL editor. Every statement is idempotent.
--
-- Money reaches the promoter without us touching it: a destination charge sends
-- the funds to their own Stripe account at the moment the guest pays, minus our
-- application fee. Stripe runs the KYC, holds the balance and pays out on its
-- own schedule. There is no step where a human at Club Fuoco moves money.

-- ── 1. Where a promoter's money goes ─────────────────────────────────────────
--
-- One Stripe Connect Express account per promoter. We store the id and a mirror
-- of the flags Stripe owns; Stripe remains the source of truth and account.updated
-- keeps this in step.
--
-- charges_enabled is the gate that matters: until Stripe says yes, the promoter
-- cannot price an event, because a charge against a disabled account fails at
-- the guest's checkout — the worst possible place to discover it.

create table if not exists public.promoter_payout_accounts (
  user_id            uuid primary key references public.users(id) on delete cascade,
  stripe_account_id  text unique,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  -- Stripe's own words for what it still wants, shown verbatim to the promoter.
  -- Paraphrasing KYC requirements is how you strand someone at "pending".
  requirements_due   text[] not null default '{}',
  disabled_reason    text,
  country            text,
  default_currency   text,
  -- Our cut, in BASIS POINTS. 1200 = 12%, the default every promoter starts on.
  --
  -- Basis points rather than a percent or a numeric: the fee is computed as an
  -- integer number of cents on every charge, and an integer rate keeps that
  -- arithmetic exact. It also expresses the rates deals actually get written at
  -- — 10%, 7.5%, 0% — without a float ever touching money.
  --
  -- Adjusted per promoter from the portal when a deal is signed. Capped at 100%
  -- by constraint; a rate above that would make Stripe reject the charge at the
  -- guest's checkout.
  platform_fee_bps   integer not null default 1200,
  fee_note           text,
  fee_updated_at     timestamptz,
  fee_updated_by     uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Promoters whose deal predates this column, and any row created before the
-- default was added, still land on 12%.
alter table public.promoter_payout_accounts
  add column if not exists platform_fee_bps integer not null default 1200,
  add column if not exists fee_note text,
  add column if not exists fee_updated_at timestamptz,
  add column if not exists fee_updated_by uuid references public.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_payout_accounts_fee_ck') then
    alter table public.promoter_payout_accounts
      add constraint promoter_payout_accounts_fee_ck
      check (platform_fee_bps >= 0 and platform_fee_bps <= 10000);
  end if;
end $$;

alter table public.promoter_payout_accounts enable row level security;

drop policy if exists "promoter reads own payout account" on public.promoter_payout_accounts;
create policy "promoter reads own payout account" on public.promoter_payout_accounts
  for select using (user_id = auth.uid());
-- No write policy: every write is either our service role or the Stripe webhook.

create index if not exists promoter_payout_accounts_stripe_idx
  on public.promoter_payout_accounts(stripe_account_id) where stripe_account_id is not null;

-- ── 2. What a spot costs ─────────────────────────────────────────────────────
--
-- 0 means free, which is every night that exists today — so this column changes
-- nothing until a promoter sets a price.

alter table public.promoter_nights
  add column if not exists price_cents integer not null default 0,
  add column if not exists currency text not null default 'eur';

alter table public.promoter_series
  add column if not exists price_cents integer not null default 0,
  add column if not exists currency text not null default 'eur';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_nights_price_ck') then
    alter table public.promoter_nights
      add constraint promoter_nights_price_ck check (price_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promoter_series_price_ck') then
    alter table public.promoter_series
      add constraint promoter_series_price_ck check (price_cents >= 0);
  end if;
end $$;

-- ── 3. Paying for a spot ─────────────────────────────────────────────────────
--
--   free    — a free night. The default, so every existing row is already right.
--   pending — checkout open. HOLDS A SPOT, and expires.
--   paid    — money captured. The only state that gets a QR.
--   refunded
--
-- Note what is NOT in this list: "saved". A saved event is deliberately not a
-- guest row — see §4.

alter table public.promoter_guests
  add column if not exists payment_status text not null default 'free',
  add column if not exists amount_cents integer,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists hold_expires_at timestamptz,
  add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_guests_payment_status_ck') then
    alter table public.promoter_guests
      add constraint promoter_guests_payment_status_ck
      check (payment_status in ('free','pending','paid','refunded'));
  end if;
end $$;

-- The sweeper's index: find holds that have lapsed.
create index if not exists promoter_guests_hold_idx
  on public.promoter_guests(hold_expires_at)
  where payment_status = 'pending';

create unique index if not exists promoter_guests_checkout_idx
  on public.promoter_guests(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ── 4. Saving an event to pay later ──────────────────────────────────────────
--
-- A save is a BOOKMARK, and it lives in its own table rather than as a state on
-- promoter_guests. That separation is the whole point.
--
-- promoter_guests is not a list of interested people — it is the door list. Its
-- rows are counted by the capacity trigger, summed into the promoter's
-- headcount, and sealed into the offline night pack that a scanner admits
-- from. A "saved, unpaid" row sitting in that table would consume a spot on a
-- sold-out night, inflate the promoter's numbers, and — worst — ride along in
-- the door pack as somebody the bouncer can let in for free.
--
-- So: saving costs nothing, holds nothing, and grants nothing. Paying creates
-- the promoter_guests row, exactly as an unpaid guest never does.

create table if not exists public.promoter_saved_events (
  user_id       uuid not null references public.users(id) on delete cascade,
  allocation_id uuid not null references public.promoter_allocations(id) on delete cascade,
  -- Kept so a saved event still resolves after a series rolls to a new week.
  invite_token  text,
  created_at    timestamptz not null default now(),
  primary key (user_id, allocation_id)
);

alter table public.promoter_saved_events enable row level security;

drop policy if exists "own saved events" on public.promoter_saved_events;
create policy "own saved events" on public.promoter_saved_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists promoter_saved_events_user_idx
  on public.promoter_saved_events(user_id, created_at desc);
