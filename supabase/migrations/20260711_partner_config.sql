-- Partner config: make the guestlist partner (currently "Rumba"/Rumbalist)
-- swappable at runtime instead of hard-coded in the web + iOS binaries.
-- A switch = flip which brand is_active (its offers are pre-seeded), and both
-- clients pick it up on their next fetch — no rebuild, no App Store release.
-- Run in the SQL editor. Data is seeded separately (scripts/seed-partner.mjs).

-- Brands: the partner identity shown to users (name, wordmark, color).
create table if not exists public.partner_brands (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,        -- stable slug, e.g. 'rumba'
  name       text not null,               -- display / wordmark text
  logo_url   text,                         -- remote wordmark (tinted by color)
  color      text not null default '#FF2D92',
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);

-- Exactly one brand may be active at a time.
create unique index if not exists partner_brands_one_active
  on public.partner_brands ((is_active)) where is_active;

-- Offers: the per-club guestlist / VIP terms, owned by a brand. The active
-- brand's rows are what the app shows. Denormalized (subtitle etc. are the
-- final display strings) — mirrors the old RUMBALIST_OFFERS shape.
create table if not exists public.partner_offers (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.partner_brands(id) on delete cascade,
  club_id     uuid not null references public.clubs(id) on delete cascade,
  kind        text not null check (kind in ('free_guestlist','vip_table')),
  title       text not null,
  subtitle    text not null,
  price_eur   numeric,          -- null = free
  party_size  int,
  time_window text not null,
  valid_days  text not null,
  dress_code  text not null,
  music       text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists partner_offers_brand_club_idx
  on public.partner_offers(brand_id, club_id, sort_order);

-- Public marketing data — readable by anyone (incl. guests / first launch).
-- Writes go through the service client only.
alter table public.partner_brands enable row level security;
alter table public.partner_offers enable row level security;

drop policy if exists "Public read partner brands" on public.partner_brands;
create policy "Public read partner brands"
  on public.partner_brands for select using (true);

drop policy if exists "Public read partner offers" on public.partner_offers;
create policy "Public read partner offers"
  on public.partner_offers for select using (true);
