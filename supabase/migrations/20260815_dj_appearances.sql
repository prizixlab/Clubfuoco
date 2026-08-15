-- Internal DJ timelines.
--
-- A DJ's upcoming dates, scraped per artist from RA's `Artist.events` — which,
-- unlike `public.events`, is NOT restricted to Barcelona. That is the point:
-- the app shows a DJ's whole run of upcoming nights, so a resident who plays
-- Berlin next week reads as a working artist rather than as a gap.
--
-- `club_id` is set only when the venue resolves to one of our clubs (i.e. a
-- Barcelona venue we carry) — those rows link through to the club page. Rows in
-- any other city are shown but not tappable: the app offers a "coming soon"
-- note for that city instead of sending the user off to Resident Advisor.
create table if not exists public.dj_appearances (
  ra_artist_id text not null references public.djs(ra_artist_id) on delete cascade,
  ra_event_id  text not null,
  title        text,
  date         date not null,
  start_time   timestamptz,
  venue_name   text,
  city         text,                                -- RA area name ("Barcelona", "Berlin")
  country      text,
  club_id      uuid references public.clubs(id),    -- non-null = a venue we carry
  updated_at   timestamptz not null default now(),
  primary key (ra_artist_id, ra_event_id)
);

create index if not exists dj_appearances_artist_date_idx
  on public.dj_appearances (ra_artist_id, date);

alter table public.dj_appearances enable row level security;

-- Public catalogue data, same as `djs`; writes are service-role only.
drop policy if exists dj_appearances_read on public.dj_appearances;
create policy dj_appearances_read on public.dj_appearances
  for select to anon, authenticated using (true);
