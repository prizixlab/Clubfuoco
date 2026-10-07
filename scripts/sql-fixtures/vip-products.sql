-- Fixture for 20261009_vip_products.sql (live column types; partner_* from
-- 20260711_partner_config.sql + later additive columns).
create extension if not exists pgcrypto;
create table public.clubs (id uuid primary key default gen_random_uuid(), name text not null);
create table public.partner_brands (
  id uuid primary key default gen_random_uuid(), key text unique not null, name text not null,
  color text not null default '#888', is_active boolean not null default false,
  offers_hidden boolean default false, fourvenues_channel text
);
create table public.partner_offers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.partner_brands(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  kind text not null check (kind in ('free_guestlist', 'vip_table')),
  title text not null, price_eur numeric, valid_days text, skipped_dates text[],
  is_active boolean default true, created_at timestamptz default now()
);
create table public.bookings (id uuid primary key default gen_random_uuid(), club_id uuid references public.clubs(id));
insert into public.clubs (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Opium');
insert into public.partner_brands (id, key, name) values ('00000000-0000-0000-0000-0000000000b1', 'rumba', 'Rumba');
insert into public.partner_offers (brand_id, club_id, kind, title, price_eur, valid_days, is_active) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'vip_table', 'VIP Table', 300, 'Every night', false),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'free_guestlist', 'Free', null, 'Sun – Fri', true);
