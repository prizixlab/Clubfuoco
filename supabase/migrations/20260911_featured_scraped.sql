-- Scraped RA listings become featurable too.
--
-- NOT APPLIED — run in the SQL editor.
--
-- The first cut deliberately excluded them: a scraped listing had no consumer
-- detail page, so featuring one would have put a card at the top of the feed
-- that opened nothing. That objection is answered by serving featured scraped
-- rows through /api/events/feed in FeedEvent shape — the app's event detail is
-- read-only anyway (no RSVP exists yet), so a scraped night renders in it
-- exactly like one of ours.
--
-- `events.ra_event_id` is TEXT, not a uuid, and the table is rewritten by the
-- scraper on every run — so this is a plain column with no foreign key. A slot
-- pointing at a listing that later disappears from the scrape simply stops
-- resolving, the same way an expired night does.

alter table public.featured_slots
  add column if not exists ra_event_id text;

-- Exactly one target, now of three. Written as a count so a fourth kind is a
-- one-word change rather than a rewritten boolean.
alter table public.featured_slots
  drop constraint if exists featured_slot_one_target;

alter table public.featured_slots
  add constraint featured_slot_one_target check (
    (night_id is not null)::int
  + (club_id is not null)::int
  + (ra_event_id is not null)::int = 1
  );

create unique index if not exists featured_slots_ra_uniq
  on public.featured_slots (ra_event_id) where ra_event_id is not null;

comment on column public.featured_slots.ra_event_id is
  'A scraped public.events listing (text PK, no FK — the scraper rewrites that table).';
