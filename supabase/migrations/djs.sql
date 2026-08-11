-- Barcelona DJ / artist catalogue, and the per-club "DJ set" slots that surface
-- a DJ on a club page in place of a real event.
--
-- WHY: some clubs have no ticketed events — their "What's on" is really just a
-- resident/featured DJ, or a genre-only format night. Those aren't events, so we
-- show them as a Featured DJ box (photo, genres, SoundCloud preview) instead of
-- an event card.
--
-- `djs` is populated (upsert on ra_artist_id) by the agentbox scraper push; see
-- the DJ ingestion brief. `club_dj_sets` is the resolved "this slot is a DJ, not
-- an event" store (ingestion §5 "set-list category") — hand-seeded for now, and
-- the ingestion will fill it from DJ-only / genre-only events later.

-- ── DJ catalogue ────────────────────────────────────────────────────────────
create table if not exists public.djs (
  ra_artist_id    text primary key,      -- RA artist id (stable natural key)
  name            text not null,
  ra_followers    int  default 0,        -- popularity signal
  genres          text[],
  instagram       text,
  soundcloud      text,                  -- profile URL (embedded as preview)
  website         text,
  bandcamp        text,
  discogs         text,
  known_venues    text[],
  regions         text[],                -- most-played first
  bcn_events_seen int  default 0,
  ra_url          text,
  image_url       text,                  -- RA CDN; re-host to Storage later
  cover_image_url text,
  bio             text,
  first_seen      date,
  last_enriched   date,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_djs_followers on public.djs (ra_followers desc);

alter table public.djs enable row level security;

drop policy if exists djs_read on public.djs;
create policy djs_read on public.djs
  for select to anon, authenticated using (true);   -- public catalogue; writes are service-role only

-- ── Per-club DJ-set slots ───────────────────────────────────────────────────
create table if not exists public.club_dj_sets (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs(id) on delete cascade,
  ra_artist_id     text not null references public.djs(ra_artist_id) on delete cascade,
  residency_label  text,                 -- e.g. "Resident" (optional, curated)
  night            text,                 -- e.g. "Saturdays"  (optional, curated)
  bookable         boolean not null default false,
  sort             int not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (club_id, ra_artist_id)
);

create index if not exists idx_club_dj_sets_club on public.club_dj_sets (club_id, sort);

alter table public.club_dj_sets enable row level security;

drop policy if exists club_dj_sets_read on public.club_dj_sets;
create policy club_dj_sets_read on public.club_dj_sets
  for select to anon, authenticated using (true);
