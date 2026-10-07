-- Fixture for 20261008_table_products.sql: the tables it references, with the
-- columns and key types of the live schema (partner_* from
-- 20260711_partner_config.sql; bookings reduced to what the FK touches).
create extension if not exists pgcrypto;
create table public.clubs (id uuid primary key default gen_random_uuid(), name text not null);
create table public.partner_brands (
  id uuid primary key default gen_random_uuid(), key text unique not null, name text not null,
  color text not null default '#888', is_active boolean not null default false, offers_hidden boolean default false
);
create table public.partner_offers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.partner_brands(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  kind text not null check (kind in ('free_guestlist', 'vip_table')),
  title text not null, price_eur numeric, is_active boolean default true
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(), club_id uuid references public.clubs(id),
  brand_id uuid references public.partner_brands(id)
);
