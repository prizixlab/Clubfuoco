-- Events tab — editorial pinning, and events we publish ourselves.
--
-- Apply MANUALLY in the Supabase SQL editor. Every statement is idempotent.
--
-- Two things the consumer Events tab needs and the schema does not yet have:
--
--   1. A pin WE control, distinct from the promotion a promoter BUYS.
--   2. A way to publish an event that has no promoter behind it.
--
-- Nothing here changes an existing row's behaviour: every column added is
-- nullable or defaulted to the value today's rows already imply.

-- ── 1. The editorial pin ─────────────────────────────────────────────────────
--
-- `featured` already exists and is NOT this. That column is a paid opt-in — the
-- promoter buys front-page promotion (see promoter_featured.sql) and is billed
-- per accepted guest. It answers "who paid?".
--
-- `pinned_at` answers "what do WE want at the top?", which is an editorial
-- judgement and must not be purchasable. Keeping them as separate columns is
-- the point: collapsing them would mean either money buys the editorial slot,
-- or we cannot pin anything a promoter has not paid for. Ranking puts the
-- editorial pin ABOVE the paid feature.
--
-- Null = not pinned. Timestamp rather than boolean so "most recently pinned"
-- is a usable default order and so the portal can show when a pin was set.

alter table public.promoter_nights
  add column if not exists pinned_at timestamptz,
  -- Explicit running order among pins, lowest first. Null sorts last, so a pin
  -- set without a rank still appears — just below the ranked ones. This is what
  -- lets one chosen event hold the hero slot rather than whichever was pinned
  -- most recently.
  add column if not exists pin_rank integer,
  -- Why it is pinned, for whoever looks at the portal next week. Never shown to
  -- consumers.
  add column if not exists pin_note text;

alter table public.promoter_series
  add column if not exists pinned_at timestamptz,
  add column if not exists pin_rank integer,
  add column if not exists pin_note text;

-- Partial indexes: the pinned set is tiny next to the table, and the consumer
-- query reads it on every feed load.
create index if not exists promoter_nights_pinned_idx
  on public.promoter_nights(pin_rank nulls last, pinned_at desc)
  where pinned_at is not null;

create index if not exists promoter_series_pinned_idx
  on public.promoter_series(pin_rank nulls last, pinned_at desc)
  where pinned_at is not null;

-- ── 2. Events we publish ourselves ───────────────────────────────────────────
--
-- A house event is an ordinary promoter_nights row with no promoter behind it.
-- That is deliberate, and it is the whole reason this is one column rather than
-- a second table: capacity triggers, promoter_guests, the QR pass, the offline
-- door pack, paid spots via Stripe and promoter_saved_events all key off
-- promoter_nights. A parallel "house_events" table would have to reimplement
-- every one of them, and each would drift.
--
-- `created_by` and `club_id` are already nullable, so a house row needs no
-- schema loosening — only a flag saying it is ours, because "created_by is
-- null" is absence of information, not a statement of ownership.

alter table public.promoter_nights
  add column if not exists is_house boolean not null default false;

alter table public.promoter_series
  add column if not exists is_house boolean not null default false;

comment on column public.promoter_nights.is_house is
  'Published by Club Fuoco itself rather than by a promoter. Carries the house brand; has no promoter payout account, so it can never be priced above zero without one.';

-- A house event has no promoter, so there is no Stripe Connect account to send
-- money to. Pricing one would fail at the guest's checkout — the worst place to
-- find out — exactly the failure 20260821_price_requires_payouts.sql exists to
-- prevent for promoters. Same guarantee, stated for house rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_nights_house_free_ck') then
    alter table public.promoter_nights
      add constraint promoter_nights_house_free_ck
      check (not is_house or price_cents = 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promoter_series_house_free_ck') then
    alter table public.promoter_series
      add constraint promoter_series_house_free_ck
      check (not is_house or price_cents = 0);
  end if;
end $$;

-- ── 3. The house brand ───────────────────────────────────────────────────────
--
-- Attribution rides on the brand, and house events are ours, so this row exists
-- mainly so a house event resolves to a brand like every other event rather
-- than to null.
--
-- `color` is set explicitly because the column DEFAULTS to '#FF2D92' — a stale
-- Rumbalist pink. The brand accent is gold #C09950 and must never read pink.
--
-- `attribution_required` is false: we are the app, so "Guestlist by Club Fuoco"
-- would be crediting ourselves to ourselves.
--
-- `is_active` is false because that flag means "the app-wide primary supplier",
-- which the house brand is not — it supplies only its own events.

-- Written as an explicit existence check rather than ON CONFLICT (key): a
-- unique constraint on `key` is not guaranteed on this table, and ON CONFLICT
-- errors outright when no matching constraint exists. This form is idempotent
-- either way.
do $$
begin
  if exists (select 1 from public.partner_brands where key = 'clubfuoco') then
    -- Correct the pink if an earlier insert took the column default.
    update public.partner_brands
       set name = 'Club Fuoco',
           color = '#C09950',
           attribution_required = false
     where key = 'clubfuoco';
  else
    insert into public.partner_brands
      (key, name, color, is_active, attribution_required, owner_user_id)
    values
      ('clubfuoco', 'Club Fuoco', '#C09950', false, false, null);
  end if;
end $$;

-- ── 4. What the consumer feed reads ──────────────────────────────────────────
--
-- The gate an event must pass to reach a guest, in one place so the API route
-- and the portal's preview cannot disagree about it.
--
--   published, approved, public, and not in the past
--
-- Ordering is the product decision: our pin first, then what a promoter paid
-- for, then soonest. Nights only — a series is a template, and its concrete
-- nights are the rows that get shown.

create or replace view public.v_events_feed as
select
  n.*,
  (n.pinned_at is not null) as is_pinned
from public.promoter_nights n
where n.is_published
  and n.review_status = 'approved'
  and n.visibility = 'public'
  and n.night_date >= (now() at time zone 'Europe/Madrid')::date
order by
  (n.pinned_at is null),        -- pinned block first
  n.pin_rank nulls last,
  n.pinned_at desc,
  n.featured desc,              -- then paid promotion
  n.night_date asc;             -- then soonest

comment on view public.v_events_feed is
  'Upcoming events a guest may see, in feed order: editorial pin, then paid feature, then soonest. Read through the service client by /api/events.';

-- No RLS change and no public policy. The consumer route reads this with the
-- service client, exactly as /api/partner already does for offers. Opening a
-- permissive SELECT policy on promoter_nights would widen access to private and
-- unapproved nights for every anon key holder, which is a much larger change
-- than this feature needs.
