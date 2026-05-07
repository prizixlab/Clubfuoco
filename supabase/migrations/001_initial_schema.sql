-- ============================================================
-- CLUB FUOCO — Initial Database Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- USERS
-- Auto-created on signup via trigger (see bottom of file)
-- ============================================================
create table if not exists public.users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text unique not null,
  phone              text,
  full_name          text,
  avatar_url         text,
  membership_tier    text not null default 'free'
                       check (membership_tier in ('free', 'gold', 'sapphire')),
  stripe_customer_id text unique,
  role               text not null default 'user'
                       check (role in ('user', 'club_staff', 'club_owner', 'admin')),
  created_at         timestamptz not null default now(),
  last_active_at     timestamptz
);

-- ============================================================
-- CLUBS
-- ============================================================
create table if not exists public.clubs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text unique not null,
  description           text,
  address               text,
  neighborhood          text,
  lat                   decimal(10, 8),
  lng                   decimal(11, 8),
  cover_image_url       text,
  gallery_urls          text[],
  music_genres          text[],
  max_capacity          integer,
  general_entry_price   decimal(10, 2),
  vip_table_min_spend   decimal(10, 2),
  instagram_handle      text,
  whatsapp_link         text,
  is_active             boolean not null default true,
  is_featured           boolean not null default false,
  owner_user_id         uuid references public.users(id),
  created_at            timestamptz not null default now()
);

-- ============================================================
-- LIVE STATUS
-- One row per club, upserted by staff throughout the night
-- ============================================================
create table if not exists public.live_status (
  id                  uuid primary key default gen_random_uuid(),
  club_id             uuid not null references public.clubs(id) on delete cascade,
  crowd_percentage    integer not null default 0
                        check (crowd_percentage between 0 and 100),
  crowd_label         text not null default 'empty'
                        check (crowd_label in ('empty', 'quiet', 'lively', 'busy', 'packed')),
  current_dj          text,
  dj_photo_url        text,
  queue_wait_minutes  integer check (queue_wait_minutes >= 0),
  is_open             boolean not null default false,
  special_note        text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.users(id),
  unique (club_id)
);

-- ============================================================
-- BOOKINGS
-- ============================================================
create table if not exists public.bookings (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.users(id),
  club_id                   uuid not null references public.clubs(id),
  booking_type              text not null
                              check (booking_type in ('general', 'vip')),
  party_size                integer not null check (party_size between 1 and 20),
  booking_date              date not null,
  arrival_window            text,
  status                    text not null default 'pending'
                              check (status in ('pending', 'confirmed', 'cancelled', 'used')),
  stripe_payment_intent_id  text,
  stripe_charge_id          text,
  unit_price                decimal(10, 2),
  total_amount              decimal(10, 2),
  platform_fee              decimal(10, 2),
  qr_code_token             text unique not null default gen_random_uuid()::text,
  checked_in_at             timestamptz,
  checked_in_by             uuid references public.users(id),
  created_at                timestamptz not null default now()
);

-- ============================================================
-- MEMBERSHIPS
-- ============================================================
create table if not exists public.memberships (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.users(id) unique,
  tier                    text not null
                            check (tier in ('gold', 'sapphire')),
  stripe_subscription_id  text,
  stripe_price_id         text,
  status                  text not null default 'active'
                            check (status in ('active', 'cancelled', 'past_due')),
  valid_from              timestamptz,
  valid_until             timestamptz,
  created_at              timestamptz not null default now()
);

-- ============================================================
-- DRINK SPECIALS
-- ============================================================
create table if not exists public.drink_specials (
  id             uuid primary key default gen_random_uuid(),
  club_id        uuid not null references public.clubs(id) on delete cascade,
  name           text,
  description    text,
  original_price decimal(10, 2),
  special_price  decimal(10, 2),
  valid_from     timestamptz,
  valid_until    timestamptz,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ============================================================
-- FAVORITES
-- ============================================================
create table if not exists public.favorites (
  user_id    uuid not null references public.users(id) on delete cascade,
  club_id    uuid not null references public.clubs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, club_id)
);

-- ============================================================
-- REVIEWS
-- Only allowed if user has a booking at that club
-- ============================================================
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id),
  club_id     uuid not null references public.clubs(id),
  booking_id  uuid references public.bookings(id),
  rating      integer not null check (rating between 1 and 5),
  body        text,
  created_at  timestamptz not null default now(),
  unique (user_id, booking_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_clubs_location       on public.clubs(lat, lng);
create index if not exists idx_clubs_slug           on public.clubs(slug);
create index if not exists idx_clubs_featured       on public.clubs(is_featured) where is_featured = true;
create index if not exists idx_clubs_active         on public.clubs(is_active) where is_active = true;

create index if not exists idx_live_status_club     on public.live_status(club_id);
create index if not exists idx_live_status_updated  on public.live_status(updated_at desc);

create index if not exists idx_bookings_user        on public.bookings(user_id, booking_date desc);
create index if not exists idx_bookings_club_date   on public.bookings(club_id, booking_date);
create index if not exists idx_bookings_qr_token    on public.bookings(qr_code_token);
create index if not exists idx_bookings_status      on public.bookings(status);

create index if not exists idx_memberships_user     on public.memberships(user_id);
create index if not exists idx_memberships_status   on public.memberships(status);

create index if not exists idx_reviews_club         on public.reviews(club_id, created_at desc);
create index if not exists idx_favorites_user       on public.favorites(user_id);
create index if not exists idx_drink_specials_club  on public.drink_specials(club_id, is_active);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.users         enable row level security;
alter table public.clubs         enable row level security;
alter table public.live_status   enable row level security;
alter table public.bookings      enable row level security;
alter table public.memberships   enable row level security;
alter table public.drink_specials enable row level security;
alter table public.favorites     enable row level security;
alter table public.reviews       enable row level security;

-- USERS
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- CLUBS — public read, admin write
create policy "Anyone can view active clubs"
  on public.clubs for select
  using (is_active = true);

create policy "Admins can manage clubs"
  on public.clubs for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'club_owner')
    )
  );

-- LIVE STATUS — public read, staff write
create policy "Anyone can read live status"
  on public.live_status for select
  using (true);

create policy "Staff can update live status"
  on public.live_status for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'club_owner', 'club_staff')
    )
  );

-- BOOKINGS — users see only their own
create policy "Users can view own bookings"
  on public.bookings for select
  using (auth.uid() = user_id);

create policy "Users can create bookings"
  on public.bookings for insert
  with check (auth.uid() = user_id);

create policy "Staff can view all bookings for their club"
  on public.bookings for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'club_owner', 'club_staff')
    )
  );

create policy "Staff can update booking status"
  on public.bookings for update
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'club_owner', 'club_staff')
    )
  );

-- MEMBERSHIPS
create policy "Users can view own membership"
  on public.memberships for select
  using (auth.uid() = user_id);

create policy "Users can create membership"
  on public.memberships for insert
  with check (auth.uid() = user_id);

create policy "System can update membership"
  on public.memberships for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- DRINK SPECIALS — public read
create policy "Anyone can view active specials"
  on public.drink_specials for select
  using (is_active = true);

create policy "Staff can manage specials"
  on public.drink_specials for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'club_owner', 'club_staff')
    )
  );

-- FAVORITES
create policy "Users can manage own favorites"
  on public.favorites for all
  using (auth.uid() = user_id);

-- REVIEWS
create policy "Anyone can read reviews"
  on public.reviews for select
  using (true);

create policy "Authenticated users can write reviews"
  on public.reviews for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- TRIGGER: auto-create user profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
