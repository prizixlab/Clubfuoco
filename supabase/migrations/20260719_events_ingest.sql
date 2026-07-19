-- Barcelona event calendar ingested from the agentbox RA scraper.
-- See EVENTS_INGEST_BRIEF.md; loaded by scripts/ingest-events.mjs.
--
-- This is SEPARATE from the older `ra_events` table, which is a thinner cache
-- written by /api/admin/sync-events (that route pulls RA's GraphQL unpaginated
-- — page 1 only — which is why it holds ~101 rows against this feed's ~190).
-- Once the feed reads from `events`, `ra_events` and that cron can be retired.

create table if not exists public.events (
  ra_event_id   text primary key,          -- RA's stable id; upsert key
  title         text        not null,
  date          date        not null,      -- listing date (local calendar day)
  start_time    timestamptz,               -- may be null; can fall after midnight
  venue_name    text        not null,      -- raw free-text string from RA
  -- Resolved venue. Nullable on purpose: only ~1/3 of RA venues exist in
  -- `clubs`, and the resolver only writes a value it is confident about.
  club_id       uuid        references public.clubs(id) on delete set null,
  -- How club_id was resolved ('exact' | 'core'), or null when unresolved.
  -- Kept so a later backfill can tell hand-mapped rows from guessed ones.
  club_match    text,
  promoters     text[]      not null default '{}',
  artists       text[]      not null default '{}',
  interested    integer     not null default 0,
  attending     integer     not null default 0,
  cost          text,                      -- free text, unreliable — never price with it
  ra_url        text,
  first_seen    date,                      -- when WE first saw it; never overwritten
  last_seen     date,                      -- last confirmed present on RA
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_events_date     on public.events (date);
create index if not exists idx_events_club_id  on public.events (club_id);
create index if not exists idx_events_club_date on public.events (club_id, date);

-- RLS: the feed reads these anonymously, the ingest writes with the service
-- role (which bypasses RLS). Without RLS enabled, Supabase's default grants
-- would let the anon key WRITE to this table, not just read it.
alter table public.events enable row level security;

drop policy if exists "events are publicly readable" on public.events;
create policy "events are publicly readable"
  on public.events for select
  to anon, authenticated
  using (true);

-- Touch updated_at on every upsert that actually changes something.
create or replace function public.touch_events_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.touch_events_updated_at();

-- Durable venue resolution (brief §5 option 3). 0% populated today; fill it in
-- to pin a venue permanently and the resolver will prefer it over name guessing.
create index if not exists idx_clubs_ra_venue_slug
  on public.clubs (ra_venue_slug) where ra_venue_slug is not null;
