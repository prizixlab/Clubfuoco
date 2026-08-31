-- Multiple hosts on an event.
--
-- Apply MANUALLY in the Supabase SQL editor. Every statement is idempotent.
--
-- A HOST is who runs the night; the LINE-UP is who plays it. They are separate
-- lists because they answer different questions and routinely disagree — a
-- brand can host a night it does not play, and a resident can play a night some
-- other collective is hosting. Folding them together would make "Club Fuoco" a
-- credited artist.
--
-- Shape mirrors `lineup`: a jsonb array of {"id","name"}. Here `id` is a
-- `partner_brands.id` when the host is a brand on our roster, and null when it
-- is free text (a one-off collective, a guest curator). Storing the id where we
-- have one means a host can later resolve to that brand's logo and attribution
-- clause instead of matching on a display string.
--
-- Not a text[] — although `public.events.promoters` is one — precisely because
-- of that id. The scraped feed has nothing to link its promoter names TO; ours
-- does.

alter table public.promoter_nights
  add column if not exists hosts jsonb not null default '[]'::jsonb;

alter table public.promoter_series
  add column if not exists hosts jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_nights_hosts_is_array') then
    alter table public.promoter_nights
      add constraint promoter_nights_hosts_is_array
      check (jsonb_typeof(hosts) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promoter_series_hosts_is_array') then
    alter table public.promoter_series
      add constraint promoter_series_hosts_is_array
      check (jsonb_typeof(hosts) = 'array');
  end if;
end $$;

comment on column public.promoter_nights.hosts is
  'Who runs the night: [{"id": partner_brands.id or null, "name": "..."}]. Distinct from `lineup`, which is who plays it.';

-- ── The feed view ────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE is safe this time, and that is the payoff from the last
-- migration: the column list is explicit, so `hosts` is APPENDED after the
-- existing final column rather than shifting anything. Replace only ever fails
-- when a name at an existing position changes.
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
  n.hosts
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
