-- A night that moves: one event, several venues, in order.
--
-- Apply MANUALLY in the Supabase SQL editor. Every statement is idempotent.
--
-- The product this exists for is the standard Barcelona beach-strip night:
-- 22:00 at a beach club for the sunset set and dinner, then 00:00 to 05:00 at
-- the club proper. Today that can only be modelled as two separate events,
-- which is wrong in every direction — the guest reserves twice, gets two
-- passes, is counted twice against two rooms, and the feed shows the same
-- night twice.
--
-- So a route is ONE promoter_nights row with an ordered list of stops:
--
--   [{"club_id": uuid|null, "name": "Bastión Beach Club",
--     "start": "22:00", "end": "00:00", "note": "Sunset set & dinner"},
--    {"club_id": uuid|null, "name": "Opium",
--     "start": "00:00", "end": "05:00", "note": "Main room"}]
--
-- One row means one reservation, one pass, one guest list, one capacity.
--
-- ── Why jsonb and not a night_stops table ────────────────────────────────────
-- Order is part of the data ("beach club FIRST, then the club"), and a set of
-- rows has no order without a position column nothing else would read. Same
-- reasoning as `lineup` and `hosts`, and the same shape family, so the client's
-- decode story stays uniform.
--
-- ── The two derived columns, and why they stay ───────────────────────────────
-- `club_id`, `open_time` and `close_time` are NOT replaced by this. They are
-- derived from the stops on write (see /api/portal/events):
--
--   club_id    = the FIRST stop's venue
--   open_time  = the FIRST stop's start
--   close_time = the LAST stop's end
--
-- That is what makes this change small instead of enormous. `bookings.club_id`
-- is NOT NULL and singular, and the pass, the Wallet styling, the arrival
-- geofence and the post-night survey all hang off it. Pointing it at the first
-- stop — where the guest actually shows up and gets scanned — means the whole
-- reservation path needs no changes at all, and the ticket card's door times
-- keep reading the true span of the night (22:00 till 05:00).

alter table public.promoter_nights
  add column if not exists stops jsonb not null default '[]'::jsonb;

alter table public.promoter_series
  add column if not exists stops jsonb not null default '[]'::jsonb;

-- Must be an array, and either empty or a REAL route.
--
-- Empty is the overwhelmingly common case and means "an ordinary night at one
-- venue" — every existing row stays exactly as it is, and nothing downstream
-- has to learn about stops to keep working.
--
-- A one-stop route is refused because it is just a night, expressed a second
-- way. Two ways to say the same thing is how the card ends up rendering a
-- pointless single-item timeline.
--
-- Element SHAPE (name/start/end) is normalised in the API route rather than
-- here: a check constraint cannot use a subquery, so per-element validation
-- would need an immutable helper function, and the only writer is that route.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_nights_stops_shape') then
    alter table public.promoter_nights
      add constraint promoter_nights_stops_shape
      check (
        jsonb_typeof(stops) = 'array'
        and (jsonb_array_length(stops) = 0 or jsonb_array_length(stops) >= 2)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promoter_series_stops_shape') then
    alter table public.promoter_series
      add constraint promoter_series_stops_shape
      check (
        jsonb_typeof(stops) = 'array'
        and (jsonb_array_length(stops) = 0 or jsonb_array_length(stops) >= 2)
      );
  end if;
end $$;

comment on column public.promoter_nights.stops is
  'An ordered route across venues: [{"club_id","name","start","end","note"}]. Empty = an ordinary single-venue night. When set, club_id/open_time/close_time are DERIVED from the first and last stop and must not be edited independently. Times are bare clocks like open_time; end < start means the next morning.';

-- ── The feed view ────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE, appending `stops` at the very end. That works only because
-- the column list here is explicit — see the long note in
-- 20260831_event_lineups.sql for what happens when it is not (`n.*` expands in
-- physical column order, and replace cannot rename a column at an existing
-- position).
--
-- Keep appending at the end. Do not insert into the middle of this list.

create or replace view public.v_events_feed as
select
  n.id,
  n.club_id,
  n.series_id,
  n.created_by,
  n.title,
  n.description,
  n.night_date,
  n.doors_at,
  n.open_time,
  n.close_time,
  n.location_name,
  n.address,
  n.lat,
  n.lng,
  n.photo_urls,
  n.lineup,
  n.theme,
  n.theme_translate,
  n.total_capacity,
  n.max_plus_ones,
  n.auto_checkin,
  n.price_cents,
  n.currency,
  n.is_published,
  n.visibility,
  n.review_status,
  n.rejection_reason,
  n.featured,
  n.is_house,
  n.pinned_at,
  n.pin_rank,
  n.pin_note,
  n.created_at,
  (n.pinned_at is not null) as is_pinned,
  n.hosts,
  n.stops
from public.promoter_nights n
where n.is_published
  and n.review_status = 'approved'
  and n.visibility = 'public'
  and n.night_date >= (now() at time zone 'Europe/Madrid')::date
order by
  (n.pinned_at is null),        -- pinned block first
  n.pin_rank nulls last,
  n.pinned_at desc,
  n.featured desc,              -- then paid promotion
  n.night_date asc;             -- then soonest

-- ── What this deliberately does NOT do ───────────────────────────────────────
--
-- Capacity stays a property of the NIGHT, not of each stop. A route sells one
-- list, and the beach club's own capacity is its business, not something we
-- track per leg. If a route ever needs per-stop caps, that is a real allocation
-- change (promoter_allocations gains a stop key) and not a column here.
--
-- Arrival check-in still fires against the FIRST stop only, because it is keyed
-- to bookings.club_id. A guest who joins the route late at Opium is not
-- auto-checked-in. That is a known gap, listed rather than half-built.
