-- 20261009_vip_products.sql
--
-- VIP tables are PRODUCTS, and the only products are the tables we have saved
-- from Fourvenues: each named table zone at a club ("BELVEDERE AREA" at Opium),
-- priced by the catalog agentbox publishes hourly. Promoters don't own VIP
-- products — they SELL these, in the order the operator ranks them:
--
--   vip_products         one row per (club, Fourvenues zone). Synced from the
--                        catalog; zone_key is the zone name normalised
--                        (Fourvenues mints a new zone id every night).
--   vip_product_sellers  the ranked promoters for a product. On a night, the
--                        highest-ranked promoter who is selling then gets the
--                        buy button; if they suspend that night or shut VIP
--                        down, the next one moves up on its own.
--   brand_vip_venues     where and when a promoter does VIP (clubs, weekdays,
--                        nights they suspended, a venue paused).
--   partner_brands       vip_paused (VIP shut down everywhere) and
--                        vip_payment (what the guest may choose: deposit,
--                        full, or both).
--
-- How the guest pays follows the seller: a promoter with a Fourvenues channel
-- (partner_brands.fourvenues_channel, the HypeList set-up) checks out on
-- Fourvenues through their own link; one without checks out with Fuoco.
--
-- The single-price "VIP Table €300" offers were never real products. What
-- they did record — that the promoter does VIP at that club on those nights —
-- is carried into brand_vip_venues below. The app and portal ignore those
-- offers from now on, whether or not the rows are ever removed.
--
-- Additive and idempotent: safe to paste twice.

create table if not exists public.vip_products (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.clubs(id) on delete cascade,
  zone_key      text not null,
  name          text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (club_id, zone_key)
);
alter table public.vip_products enable row level security;

create table if not exists public.vip_product_sellers (
  product_id  uuid not null references public.vip_products(id) on delete cascade,
  brand_id    uuid not null references public.partner_brands(id) on delete cascade,
  rank        integer not null default 0,
  primary key (product_id, brand_id)
);
alter table public.vip_product_sellers enable row level security;

create table if not exists public.brand_vip_venues (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.partner_brands(id) on delete cascade,
  club_id        uuid not null references public.clubs(id) on delete cascade,
  valid_days     text not null default 'Every night',
  skipped_dates  text[] not null default '{}',
  paused         boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (brand_id, club_id)
);
alter table public.brand_vip_venues enable row level security;

alter table public.partner_brands add column if not exists vip_paused boolean not null default false;
alter table public.partner_brands add column if not exists vip_payment text not null default 'both';
do $$ begin
  alter table public.partner_brands
    add constraint partner_brands_vip_payment_check check (vip_payment in ('both', 'deposit', 'full'));
exception when duplicate_object then null; end $$;

-- What a Fuoco-checkout table booking bought.
alter table public.bookings add column if not exists vip_product_id uuid
  references public.vip_products(id) on delete set null;

-- Remember who does VIP where, from the single-price offers.
insert into public.brand_vip_venues (brand_id, club_id, valid_days, skipped_dates)
select distinct on (brand_id, club_id)
       brand_id, club_id,
       coalesce(nullif(trim(valid_days), ''), 'Every night'),
       coalesce(skipped_dates, '{}')
  from public.partner_offers
 where kind = 'vip_table'
 order by brand_id, club_id, is_active desc nulls last, created_at desc
on conflict (brand_id, club_id) do nothing;
