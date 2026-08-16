-- Event detail we were leaving on the table.
--
-- All four are exposed by RA's Event/Venue types and measured well-populated on
-- live Barcelona listings (60-event sample): end_time 100%, venue_capacity
-- 100%, minimum_age 72%, lineup 100%.
--
-- Deliberately NOT added, because RA returns them empty for this city and an
-- always-null column invites UI to be built on nothing:
--   setTimes  — populated only for festivals; 0/60 club nights had it.
--   tickets[] — only for events RA sells itself; 0/60. Real prices stay
--               unavailable, and `cost` free-text remains untrustworthy.
alter table public.events
  -- Closing time. We stored only the door time, so a night that runs to 06:00
  -- was indistinguishable from one ending at midnight.
  add column if not exists end_time       timestamptz,
  -- Door age policy, as an integer ("18"). Null means RA has no policy on file,
  -- NOT that the night is all-ages — never render an absence as "no limit".
  add column if not exists minimum_age    int,
  -- RA types capacity as a String and it arrives as free text ("1000",
  -- "500-1000"), so keep it text rather than lying about precision.
  add column if not exists venue_capacity text,
  -- Ordered lineup WITH RA artist ids, e.g.
  --   [{"id": "72992", "name": "Silverlining"}, ...]
  -- The existing `artists` text[] carries names only and in no meaningful
  -- order. This preserves billing order, and the ids let the app join a credit
  -- to a DJ page exactly instead of matching on name — the same fragile join
  -- that made venue linking painful.
  add column if not exists lineup         jsonb;

-- The app looks up credits by artist id; without this that is a full scan of
-- every upcoming event's lineup.
create index if not exists events_lineup_gin on public.events using gin (lineup);
