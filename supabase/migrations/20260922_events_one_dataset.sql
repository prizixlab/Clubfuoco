-- Events become ONE dataset, with origin as a column rather than a table.
--
-- NOT APPLIED — run in the SQL editor, top to bottom, in one go.
--
-- THE PROBLEM. The same real-world night lived in two tables:
--
--   events      1683 rows, written by agentbox's RA programme scrape. Carries
--               the bill — artists, lineup, is_dj_set, capacity, minimum age —
--               and no prices at all.
--   ra_events    111 rows, written by the Vercel cron in /api/admin/sync-events.
--               Carries the ticketing side — base_price, display_price,
--               currency, sold_out, platform_url — and no lineup.
--
-- So "what is on" and "what it costs" were different rows with different keys,
-- written by different jobs, and every consumer had to know. The iOS app grew
-- three models for it (ClubEvent, ExternalEvent, FeedEvent) and queries both
-- tables; the DJ-score job reads only `events`, so a night that existed solely
-- in the ticket cache was invisible to it. `ra_events.platform` is 'ra' on all
-- 111 rows, so the split was not even buying multi-platform support.
--
-- AFTER THIS. `events` is the one table. Origin is data:
--
--   origin        where the row came from — 'scrape:ra', 'scrape:eventbrite',
--                 'promoter', 'venue', 'staff', 'inferred'
--   source_ref    the upstream id, prefixed as the platform gives it
--                 ('ra_2513778'), so it round-trips to the source
--   source_url    the canonical upstream page
--   source_at     when the source last confirmed this row
--   locked_fields columns a HUMAN set, which no scraper may overwrite
--
-- `locked_fields` is the part that matters operationally. sync-events upserts
-- every morning at 06:00, so today a promoter correcting a door time or a
-- lineup loses it overnight with no error. This is the same contract that
-- already protects hand-curated rows in club_dj_sets (source='manual' vs
-- 'auto', see dj_linker.sql) — generalised, and enforced in the job.
--
-- promoter_nights is deliberately NOT merged. It is a different kind of object:
-- review_status, rejection_reason, price_cents, total_capacity, allocations,
-- visibility. Folding an approval pipeline and a payout path onto scraped
-- listings would make a third of every row null and teach the money code to
-- skip rows. One dataset to READ is what was wanted, and the `event_feed` view
-- at the bottom provides exactly that without moving the writes.
--
-- MEASURED BEFORE WRITING THIS (production, 22 Sep 2026): events has 1683 rows
-- with 1683 distinct non-null ra_event_id, so the unique index on source_ref is
-- safe. Of the 111 ra_events rows, 95 already match an events row (they gain
-- prices) and 16 do not (they become new event rows). After applying, expect
-- events at 1699 and 95 rows with a non-null display_price.
--
-- NOT EXECUTED ANYWHERE. There is no local Postgres, Docker or supabase CLI on
-- this machine, so this file has been written and reviewed but never run. Read
-- it before pasting.
--
-- BACKWARDS COMPATIBILITY. The shipped iOS build queries `ra_events` directly,
-- so the table is renamed (not dropped — it stays as a safety net) and a view
-- of the same name and shape takes its place. Two consumer contracts in that
-- build are load-bearing and reproduced exactly:
--   * Queries.swift eventImages() filters `id IN ('ra_<n>', …)` and then strips
--     the leading 'ra_', so the view's `id` must keep that exact prefix form.
--   * Queries.swift upcomingEvents() filters and orders on `event_date` (a
--     timestamp) while reading `date` as a string it truncates to 10 chars —
--     so `date` must render as yyyy-MM-dd… and `event_date` must stay a
--     timestamptz.

begin;

-- ── 1. Provenance on events ─────────────────────────────────────────────────

alter table public.events
  add column if not exists origin        text not null default 'scrape:ra',
  add column if not exists source_ref    text,
  add column if not exists source_url    text,
  add column if not exists source_at     timestamptz,
  add column if not exists locked_fields text[] not null default '{}';

-- Ticketing, moving in from ra_events.
alter table public.events
  add column if not exists base_price    numeric(10,2),
  add column if not exists display_price numeric(10,2),
  add column if not exists currency      text,
  add column if not exists sold_out      boolean not null default false;

do $$ begin
  alter table public.events
    add constraint events_origin_ck check (origin in (
      'scrape:ra', 'scrape:eventbrite', 'scrape:fourvenues',
      'promoter', 'venue', 'staff', 'inferred'));
exception when duplicate_object then null; end $$;

comment on column public.events.origin is
  'Where this row came from. Scrapers may only write rows whose origin they own.';
comment on column public.events.locked_fields is
  'Columns a human set. Scrapers must never overwrite these. See sync-events.';

-- Existing rows are all the RA programme scrape.
update public.events
   set source_ref = coalesce(source_ref, 'ra_' || ra_event_id),
       source_url = coalesce(source_url, ra_url),
       source_at  = coalesce(source_at, updated_at, created_at)
 where source_ref is null or source_url is null or source_at is null;

create index if not exists events_origin_idx    on public.events(origin);
create unique index if not exists events_source_ref_idx
  on public.events(source_ref) where source_ref is not null;

-- ── 2. Fold the ticket cache in ─────────────────────────────────────────────
-- Prices onto the nights we already have. `ra_events.id` is 'ra_<ra id>', which
-- is `events.ra_event_id` with a prefix.

update public.events e
   set base_price    = r.base_price,
       display_price = r.display_price,
       currency      = r.currency,
       sold_out      = coalesce(r.sold_out, false),
       -- The programme scrape has no artwork; the ticket cache does. Only fill
       -- a gap — never overwrite an image the programme or a human supplied.
       image         = coalesce(e.image, r.image),
       source_at     = greatest(coalesce(e.source_at, r.synced_at), r.synced_at)
  from public.ra_events r
 where e.ra_event_id = regexp_replace(r.id, '^[a-z]+_', '');

-- Nights that exist ONLY in the ticket cache become first-class event rows.
-- They have no lineup, which is correct: nobody scraped one.
insert into public.events (
  ra_event_id, title, date, start_time, venue_name, image,
  base_price, display_price, currency, sold_out,
  origin, source_ref, source_url, source_at, first_seen, last_seen
)
select
  regexp_replace(r.id, '^[a-z]+_', ''),
  r.title,
  r.date::date,
  r.start_time::timestamptz,
  r.venue_name,
  r.image,
  r.base_price, r.display_price, r.currency, coalesce(r.sold_out, false),
  -- sync-events writes platform: 'eventbrite' (see SyncedEvent); 'eb' is only
  -- ever the id prefix. Accept both so neither spelling lands as 'scrape:ra'.
  case when r.platform in ('eb', 'eventbrite') then 'scrape:eventbrite'
       else 'scrape:ra' end,
  r.id,
  r.platform_url,
  r.synced_at,
  coalesce(r.synced_at::date, current_date),
  coalesce(r.synced_at::date, current_date)
from public.ra_events r
where not exists (
  select 1 from public.events e
   where e.ra_event_id = regexp_replace(r.id, '^[a-z]+_', ''))
on conflict do nothing;

-- ── 3. ra_events becomes a view over the one table ──────────────────────────
-- Renamed rather than dropped: 111 rows of history, kept until someone is sure.
-- Drop public.ra_events_legacy when you are.

-- Rename only if it is still a BASE TABLE. ALTER TABLE ... RENAME also works on
-- views, so without this guard a second run would rename the compatibility view
-- itself and collide with ra_events_legacy.
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'ra_events'
       and table_type = 'BASE TABLE'
  ) then
    execute 'alter table public.ra_events rename to ra_events_legacy';
  end if;
end $$;

create or replace view public.ra_events as
select
  e.source_ref                                        as id,
  -- 'scrape:ra' → 'ra'. The old column only ever held the bare platform slug.
  split_part(e.origin, ':', 2)                        as platform,
  e.title,
  e.venue_name,
  -- Must stay a timestamptz: the iOS feed filters and orders on it.
  coalesce(e.start_time, e.date::timestamptz)         as event_date,
  e.date,
  e.start_time,
  e.image,
  e.base_price,
  e.display_price,
  e.currency,
  e.sold_out,
  (e.club_id is not null)                             as venue_matched,
  e.source_at                                         as synced_at
from public.events e
where e.origin like 'scrape:%'
  and e.source_ref is not null;

comment on view public.ra_events is
  'Compatibility shim for the shipped iOS build and the web ticket helpers. Reads only. New code should query public.events directly.';

-- ── 4. One dataset to read: scraped listings + promoter nights ──────────────
-- `kind` discriminates, so a caller can take everything or one side. Only the
-- columns both sides genuinely have; anything promoter-specific (capacity,
-- approvals, allocations) stays on promoter_nights where it means something.

create or replace view public.event_feed as
select
  'event'::text                     as kind,
  e.source_ref                      as ref,
  e.origin,
  e.club_id,
  e.title,
  e.date,
  e.start_time,
  e.end_time,
  e.venue_name,
  e.image,
  e.lineup,
  e.display_price                   as price,
  e.currency,
  e.sold_out,
  e.is_dj_set,
  true                              as is_public,
  e.source_at                       as updated_at
from public.events e
union all
select
  'promoter_night'::text            as kind,
  n.id::text                        as ref,
  'promoter'::text                  as origin,
  n.club_id,
  n.title,
  n.night_date                      as date,
  -- NOT n.doors_at: it is null on all 752 rows and its declared type could not
  -- be verified without catalog access, so unioning it against events.start_time
  -- (timestamptz) risks a type error on a column carrying no information. Add it
  -- here once it is populated and its type is known.
  null::timestamptz                 as start_time,
  null::timestamptz                 as end_time,
  n.location_name                   as venue_name,
  -- photo_urls is text[] (promoter_event_details.sql), NOT jsonb — so this is
  -- array subscripting, not a json operator. Postgres arrays are 1-based.
  (n.photo_urls)[1]                 as image,
  n.lineup,
  (n.price_cents / 100.0)           as price,
  n.currency,
  false                             as sold_out,
  false                             as is_dj_set,
  -- A promoter night only belongs in a public feed once it is published AND
  -- approved AND not private. Getting this wrong leaks an unapproved night.
  (n.is_published
     and coalesce(n.review_status, 'approved') = 'approved'
     and coalesce(n.visibility, 'public') = 'public')  as is_public,
  n.created_at                      as updated_at
from public.promoter_nights n;

comment on view public.event_feed is
  'Every night, scraped or promoter-authored, in one shape. Filter is_public before showing anything to a guest.';

commit;
