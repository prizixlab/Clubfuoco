-- Event artwork + description, captured by the agentbox RA scraper where RA
-- exposes them. See EVENTS_INGEST_BRIEF.md §3, §6 and the 2026-08-12 update.
--
-- Until now `events` held no artwork or copy: the club-page event box had to
-- borrow a flyer from the thinner `ra_events` ticket cache (only ~9% of events
-- overlapped it) and could show no description at all. These two nullable
-- columns let the scraper store both directly, so the box fills from one
-- source. Both stay null where RA has nothing — "where available".
alter table public.events
  add column if not exists image       text,   -- flyer URL (RA CDN), when RA has one
  add column if not exists description text;   -- event copy (plain text), when RA has one
