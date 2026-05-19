-- Venue presence signals — passive evidence that a user visited a club.
--
--   maps_click / uber_click : the user tapped "Get Directions" or "Ride with
--                             Uber" toward this venue (intent signal).
--   geo_presence            : on app-open, the device was within range of this
--                             venue during plausible hours (presence signal).
--
-- A signal becomes a "Were you at X?" prompt; the user's answer is recorded in
-- `confirmed`, turning it into a verified (or denied) visit.
--
-- Run this in the Supabase SQL editor.

create table if not exists venue_signals (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null,
  club_id    text        not null,
  kind       text        not null check (kind in ('maps_click','uber_click','geo_presence')),
  distance_m int,                       -- device distance to the venue, geo only
  asked      boolean     not null default false,  -- shown in a "did you go?" prompt
  confirmed  boolean,                   -- null = unanswered, true = went, false = didn't
  created_at timestamptz not null default now()
);

create index if not exists venue_signals_user_idx  on venue_signals (user_id, created_at desc);
create index if not exists venue_signals_pending_idx on venue_signals (user_id, asked, created_at desc);

-- RLS on; all access is through API routes using the service role.
alter table venue_signals enable row level security;
