-- Algorithmic slots: a tier can hold a RULE instead of a named thing.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Two rules, and the difference between them is money:
--
--   'organic'  rank on fit and quality alone — rating, taste match, real
--              programming. We earn nothing from what this surfaces.
--   'revenue'  rank on what pays us — a promoter's paid promotion first, then
--              live offers, VIP tables, billed nights.
--
-- Both already exist in the client's ShelfBuilder; until now the revenue one
-- was simply always on, unnamed and unchooseable. Making them slots means the
-- desk says which one is running, and can put a hand-picked card above it.
--
-- A slot is now exactly one of four things: a night, a venue, a scraped
-- listing, or a rule.

alter table public.featured_slots
  add column if not exists auto_mode text
  check (auto_mode is null or auto_mode in ('organic', 'revenue'));

alter table public.featured_slots
  drop constraint if exists featured_slot_one_target;

alter table public.featured_slots
  add constraint featured_slot_one_target check (
    (night_id is not null)::int
  + (club_id is not null)::int
  + (ra_event_id is not null)::int
  + (auto_mode is not null)::int = 1
  );

-- One of each rule per tier at most: two copies of the same algorithm in one
-- shelf would just repeat itself.
create unique index if not exists featured_slots_auto_uniq
  on public.featured_slots (tier, auto_mode) where auto_mode is not null;

comment on column public.featured_slots.auto_mode is
  'An algorithmic slot rather than a named one. organic = ranked on fit, we earn nothing; revenue = ranked on what pays.';
