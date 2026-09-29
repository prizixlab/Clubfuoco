-- Stand-in for the live schema, only as far as the migrations under test touch.
-- `events` is the REAL ddl from supabase/migrations/20260719_events_ingest.sql.
-- The others are reconstructed from live column lists + types verified either
-- in the repo's own migrations or by sampling production.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  eventbrite_organizer_id text
);

create table public.users (id uuid primary key default gen_random_uuid());

-- Verbatim from 20260719_events_ingest.sql
create table if not exists public.events (
  ra_event_id   text primary key,
  title         text        not null,
  date          date        not null,
  start_time    timestamptz,
  venue_name    text        not null,
  club_id       uuid        references public.clubs(id) on delete set null,
  club_match    text,
  promoters     text[]      not null default '{}',
  artists       text[]      not null default '{}',
  interested    integer     not null default 0,
  attending     integer     not null default 0,
  cost          text,
  ra_url        text,
  first_seen    date,
  last_seen     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Later additions (20260816_events_detail_batch.sql, dj_linker.sql, 20260831)
alter table public.events
  add column if not exists is_dj_set      boolean not null default false,
  add column if not exists image          text,
  add column if not exists description    text,
  add column if not exists end_time       timestamptz,
  add column if not exists minimum_age    integer,
  add column if not exists venue_capacity text,
  add column if not exists lineup         jsonb;

-- ra_events: live column list; `date`/`start_time` render without a zone in the
-- API ("2026-09-25T00:00:00.000"), so timestamp, not timestamptz.
create table public.ra_events (
  id            text primary key,
  platform      text not null,
  title         text,
  venue_name    text,
  event_date    timestamptz,
  date          timestamp,
  start_time    timestamp,
  image         text,
  base_price    numeric,
  display_price numeric,
  currency      text,
  platform_url  text,
  sold_out      boolean default false,
  venue_matched boolean default false,
  synced_at     timestamptz
);

-- promoter_nights: only the columns event_feed reads. photo_urls text[] is from
-- promoter_event_details.sql; lineup jsonb from 20260831_event_lineups.sql.
create table public.promoter_nights (
  id             uuid primary key default gen_random_uuid(),
  club_id        uuid references public.clubs(id) on delete cascade,
  title          text,
  night_date     date,
  doors_at       timestamptz,
  location_name  text,
  photo_urls     text[] not null default '{}',
  lineup         jsonb not null default '[]'::jsonb,
  price_cents    integer,
  currency       text not null default 'eur',
  is_published   boolean default false,
  review_status  text,
  visibility     text,
  created_at     timestamptz not null default now()
);

-- For the dj-scores migration's FKs.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  booking_date date not null,
  status text
);
create table public.booking_surveys (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  vibe_rating int
);

-- Seed enough rows to exercise the backfill: 2 overlapping, 1 ticket-only.
insert into public.clubs (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Ku');
insert into public.events (ra_event_id, title, date, start_time, venue_name, club_id, image, lineup) values
  ('2003865', 'HALE-BOPP Vol.4', '2026-09-04', '2026-09-04T15:00:00+00:00', 'Buena Onda', null, 'https://img/a.jpg', '[{"id":"29979","name":"Carlos Lamar"}]'),
  ('2477436', 'Housy at Noxe',   '2026-07-15', null, 'Noxe', '11111111-1111-1111-1111-111111111111', null, null);
insert into public.ra_events (id, platform, title, venue_name, event_date, date, start_time, image, base_price, display_price, currency, platform_url, sold_out, synced_at) values
  ('ra_2003865', 'ra', 'HALE-BOPP Vol.4', 'Buena Onda', '2026-09-04T15:00:00Z', '2026-09-04T00:00:00', '2026-09-04T15:00:00', 'https://img/ticket.jpg', 0, 12.5, 'EUR', 'https://ra.co/events/2003865', false, now()),
  ('ra_2477436', 'ra', 'Housy at Noxe',   'Noxe',       '2026-07-15T22:00:00Z', '2026-07-15T00:00:00', '2026-07-15T22:00:00', 'https://img/noxe.jpg',  0, 0,    'EUR', 'https://ra.co/events/2477436', false, now()),
  ('ra_9999999', 'ra', 'Ticket Only Night','Boris',     '2026-09-25T23:59:00Z', '2026-09-25T00:00:00', '2026-09-25T23:59:00', 'https://img/boris.jpg', 0, 15,   'EUR', 'https://ra.co/events/9999999', false, now()),
  ('eb_5555555', 'eventbrite', 'EB Night','Sala',       '2026-10-01T21:00:00Z', '2026-10-01T00:00:00', '2026-10-01T21:00:00', null,                    0, 9,    'EUR', 'https://eventbrite/e/5555555', false, now());
insert into public.promoter_nights (club_id, title, night_date, location_name, photo_urls, price_cents, is_published, review_status, visibility) values
  ('11111111-1111-1111-1111-111111111111', 'Fuoco House Night', '2026-09-30', 'Ku', array['https://img/promo.jpg'], 1500, true, 'approved', 'public'),
  ('11111111-1111-1111-1111-111111111111', 'Unapproved Night',  '2026-10-02', 'Ku', '{}', 0, true, 'pending', 'public');
