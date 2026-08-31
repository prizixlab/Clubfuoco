-- Line-ups on our own events.
--
-- Apply MANUALLY in the Supabase SQL editor. Every statement is idempotent.
--
-- Shape is deliberately IDENTICAL to `public.events.lineup` (the scraped RA
-- feed): a jsonb array of {"id","name"} where `id` is RA's artist id — the same
-- key `djs.ra_artist_id` uses, so a credit resolves to a real DJ row rather
-- than matching loosely by name.
--
-- Reusing that shape rather than inventing one means the native `LineupCredit`
-- type, its `credits` / `visibleCredits` / `extraCredits` helpers and the DJ
-- page link all work on our events with no new client code.
--
-- A jsonb column rather than a join table, for the same reason the scraped feed
-- chose one: billing order is part of the data ("Marea, Dyad, then Iker"), and
-- a set of rows has no order without carrying a position column that nothing
-- else would ever read.

alter table public.promoter_nights
  add column if not exists lineup jsonb not null default '[]'::jsonb;

alter table public.promoter_series
  add column if not exists lineup jsonb not null default '[]'::jsonb;

-- Must be an ARRAY. Without this a single object or a bare string would decode
-- to nothing on the client and the line-up would silently vanish from the card
-- rather than failing loudly here.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_nights_lineup_is_array') then
    alter table public.promoter_nights
      add constraint promoter_nights_lineup_is_array
      check (jsonb_typeof(lineup) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promoter_series_lineup_is_array') then
    alter table public.promoter_series
      add constraint promoter_series_lineup_is_array
      check (jsonb_typeof(lineup) = 'array');
  end if;
end $$;

comment on column public.promoter_nights.lineup is
  'Billed artists in order: [{"id": ra_artist_id, "name": "..."}]. Same shape as public.events.lineup; id joins to djs.ra_artist_id.';

-- ── The feed view ────────────────────────────────────────────────────────────
--
-- DROPPED and recreated, not CREATE OR REPLACE'd, and the column list is now
-- EXPLICIT rather than `n.*`. Both changes exist for the same reason.
--
-- The first version selected `n.*, (...) as is_pinned`. `n.*` expands in table
-- column order, so adding `lineup` to promoter_nights slid it into the position
-- `is_pinned` used to hold. CREATE OR REPLACE VIEW may only APPEND columns —
-- it cannot rename one at an existing position — so it failed with
-- "cannot change name of view column is_pinned to lineup".
--
-- Naming every column pins the positions to this file instead of to the
-- table's physical column order. Adding a column to promoter_nights now
-- changes nothing here, and surfacing a new one is an append to the end of this
-- list, which CREATE OR REPLACE accepts. Keep `is_pinned` last and add below
-- it, and this view never needs dropping again.

drop view if exists public.v_events_feed;

create view public.v_events_feed as
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
  (n.pinned_at is not null) as is_pinned
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

comment on view public.v_events_feed is
  'Upcoming events a guest may see, in feed order: editorial pin, then paid feature, then soonest. Read through the service client by /api/events/feed. Column list is explicit on purpose — see the note in 20260831_event_lineups.sql.';
