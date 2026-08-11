-- Which entry point a guestlist open came from: the Featured DJ menu ("dj") vs
-- a club's normal offer card ("club"). Fire-and-forget telemetry, mirrors
-- transport_clicks; never blocks the booking flow.
create table if not exists public.guestlist_clicks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id) on delete set null,
  source         text not null,        -- 'dj' | 'club'
  club_place_id  text,                 -- clubs.id the guestlist is for
  club_name      text,
  offer_kind     text,                 -- 'vip' | 'free'
  dj_ra_id       text,                 -- when source = 'dj'
  night          text,                 -- the DJ's night, when source = 'dj'
  clicked_at     timestamptz not null default now()
);

create index if not exists idx_guestlist_clicks_source on public.guestlist_clicks (source, clicked_at desc);
create index if not exists idx_guestlist_clicks_club   on public.guestlist_clicks (club_place_id, clicked_at desc);

alter table public.guestlist_clicks enable row level security;

create policy guestlist_clicks_insert_own on public.guestlist_clicks
  for insert to authenticated
  with check (auth.uid() = user_id or user_id is null);
