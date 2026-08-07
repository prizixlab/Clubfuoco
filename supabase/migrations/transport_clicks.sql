-- Track every "Directions" (Apple Maps) / "Uber" tap on a club detail page so
-- we know which venues guests are actually trying to travel to (demand signal
-- independent of bookings), and which transport option they prefer.
create table if not exists public.transport_clicks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id) on delete set null,
  platform       text not null,        -- 'maps' | 'uber'
  club_place_id  text,                 -- the club they tried to get to (Place ID)
  club_name      text,
  clicked_at     timestamptz not null default now()
);

create index if not exists idx_transport_clicks_platform_date on public.transport_clicks (platform, clicked_at desc);
create index if not exists idx_transport_clicks_club          on public.transport_clicks (club_place_id, clicked_at desc);
create index if not exists idx_transport_clicks_user          on public.transport_clicks (user_id, clicked_at desc);

-- RLS: users can insert their own clicks (or anonymous, user_id null); only
-- service role reads.
alter table public.transport_clicks enable row level security;

create policy transport_clicks_insert_own on public.transport_clicks
  for insert
  to authenticated
  with check (auth.uid() = user_id or user_id is null);
