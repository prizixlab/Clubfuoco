-- 20261008_table_products.sql
--
-- Every VIP table is its own product, whoever sells it and however it is
-- booked — one of our promoters through Fuoco checkout, or Fourvenues.
--
-- Before this, a VIP "product" was a whole venue: club_offer_visibility
-- decided one supplier for (club, 'vip_table', night) and every table there
-- went with it, and the app dropped ALL of our tables on any night Fourvenues
-- sold one. Now:
--
--   • A listing on its own (one partner_offers row, or one Fourvenues zone at
--     a club) is already a product. It shows. Nothing contests it.
--   • When two listings are the SAME physical table (Rumba's "Gold Booth" and
--     the venue's Fourvenues "GOLD VIP"), the operator groups them into one
--     club_tables row and the backend picks who gets the buy button:
--
--       seller = 'auto'        every listing of this table shows
--                'offer'       only seller_offer_id (one of ours) shows
--                'fourvenues'  only the Fourvenues zone(s) show
--                'none'        nobody sells this table
--
-- Fourvenues zones are matched by NAME, normalised (lowercase, no accents,
-- single spaces): Fourvenues mints a new zone id every night, so the name at
-- a club is the only key that survives. agentbox's catalog carries club_id.
--
-- Additive and idempotent. Code reads all of it defensively, so the app runs
-- exactly as before until this is pasted into the SQL editor.

create table if not exists public.club_tables (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references public.clubs(id) on delete cascade,
  name              text not null,
  fourvenues_zones  text[] not null default '{}',
  seller            text not null default 'auto'
                    check (seller in ('auto', 'offer', 'fourvenues', 'none')),
  seller_offer_id   uuid references public.partner_offers(id) on delete set null,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists club_tables_club_idx on public.club_tables (club_id);

-- Server-only: read and written through the service role (portal + /api/partner).
alter table public.club_tables enable row level security;

-- Which table a listing of ours sells. Null = a product on its own.
alter table public.partner_offers
  add column if not exists table_id uuid references public.club_tables(id) on delete set null;

create index if not exists partner_offers_table_idx
  on public.partner_offers (table_id) where table_id is not null;

-- The exact listing a VIP booking bought, so attribution and price come from
-- the table the guest tapped instead of a guess per venue.
alter table public.bookings
  add column if not exists offer_id uuid references public.partner_offers(id) on delete set null;
