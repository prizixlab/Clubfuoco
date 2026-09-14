-- Ticket releases: a paid night sells in waves, not at one flat price.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Up to 20 releases per night, each with its own price, its own cut-off, and
-- optionally its own allocation of tickets. The one on sale at any moment is
-- the lowest-position release that has neither expired nor sold out — so a
-- release ends on WHICHEVER COMES FIRST, its date or its last ticket. That is
-- how every ticketing product behaves and what a promoter means by "early bird,
-- 100 tickets, until Friday".
--
-- `promoter_nights.price_cents` stays, and stays authoritative when a night has
-- no releases. It is also kept in step with the live release by trigger below,
-- so every existing reader — the invite page, the checkout, the feed, the
-- wallet pass — keeps showing the right number without being rewritten.

create table if not exists public.night_releases (
  id          uuid primary key default gen_random_uuid(),
  night_id    uuid not null references public.promoter_nights(id) on delete cascade,
  -- Order of sale, 1 first. Not a date sort: two releases may share a cut-off,
  -- and the promoter's stated order is what decides which sells first.
  position    smallint not null check (position between 1 and 20),
  -- "Early bird", "Phase 2". Optional — plenty of nights just have prices.
  name        text,
  price_cents integer not null check (price_cents >= 0),
  -- When this release stops selling. NULL = it runs until the night itself,
  -- which is what the LAST release almost always wants.
  ends_at     timestamptz,
  -- Tickets this release may sell, counted in HEADS (a guest plus their
  -- plus-ones), matching how capacity is counted everywhere else.
  -- NULL = no limit, so it runs purely on its date.
  quantity    integer check (quantity is null or quantity > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint night_releases_position_uniq unique (night_id, position)
);

create index if not exists night_releases_night_idx
  on public.night_releases (night_id, position);

-- Which release a spot was sold under. Nullable: free spots, and every ticket
-- sold before this existed, have none. This is what makes "sold per release" a
-- COUNT rather than a counter that can drift out of step with reality.
alter table public.promoter_guests
  add column if not exists release_id uuid references public.night_releases(id) on delete set null;

create index if not exists promoter_guests_release_idx
  on public.promoter_guests (release_id) where release_id is not null;

-- Twenty, and no more. Enforced here rather than in the app because the app is
-- not the only writer — the portal and any future import land in this table too.
create or replace function public.check_release_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.night_releases where night_id = new.night_id) > 20 then
    raise exception 'A night can have at most 20 releases';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_cap on public.night_releases;
create constraint trigger trg_release_cap
  after insert on public.night_releases
  deferrable initially deferred
  for each row execute function public.check_release_cap();

-- Heads already sold under one release: paid spots, plus holds that are still
-- alive. An abandoned Stripe page must not keep a release sold out, which is
-- the same rule the checkout applies to the night's own capacity.
create or replace function public.release_sold(r uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(1 + coalesce(g.plus_ones, 0)), 0)::int
    from public.promoter_guests g
   where g.release_id = r
     and (g.payment_status <> 'pending'
          or (g.hold_expires_at is not null and g.hold_expires_at > now()));
$$;

-- The release currently on sale: lowest position, not past its cut-off, not
-- sold out. NULL when a night has no releases (flat price) or they are all
-- spent — the caller then falls back to promoter_nights.price_cents.
create or replace function public.active_release(n uuid)
returns public.night_releases
language sql
stable
as $$
  select r.*
    from public.night_releases r
   where r.night_id = n
     and (r.ends_at is null or r.ends_at > now())
     and (r.quantity is null or public.release_sold(r.id) < r.quantity)
   order by r.position
   limit 1;
$$;

-- Keep promoter_nights.price_cents equal to the live release's price.
--
-- This is the compatibility hinge of the whole feature: every existing reader
-- of price_cents keeps working untouched, and a night with releases can never
-- advertise one price on a card and charge another at the till.
create or replace function public.sync_night_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.night_id, old.night_id);
  live   public.night_releases;
begin
  select * into live from public.active_release(target);
  if live.id is not null then
    update public.promoter_nights set price_cents = live.price_cents where id = target;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_night_price on public.night_releases;
create trigger trg_sync_night_price
  after insert or update or delete on public.night_releases
  for each row execute function public.sync_night_price();

alter table public.night_releases enable row level security;

-- A promoter manages the releases on their own nights; everyone may read them,
-- because the whole point is that a guest can see what the price becomes and
-- when. Mirrors how promoter_nights itself is exposed.
drop policy if exists "releases readable" on public.night_releases;
create policy "releases readable" on public.night_releases
  for select to anon, authenticated using (true);

drop policy if exists "promoter writes own releases" on public.night_releases;
create policy "promoter writes own releases" on public.night_releases
  for all to authenticated
  using (
    exists (select 1 from public.promoter_allocations a
             where a.night_id = night_releases.night_id and a.promoter_id = auth.uid())
  )
  with check (
    exists (select 1 from public.promoter_allocations a
             where a.night_id = night_releases.night_id and a.promoter_id = auth.uid())
  );

comment on table public.night_releases is
  'Up to 20 priced waves per night. The live one is the lowest position not past its ends_at and not sold out; promoter_nights.price_cents is kept in step with it by trigger.';
