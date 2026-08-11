-- Auto-linking events → DJ sets.
--
-- Some RA "events" at a club are really just one resident/guest DJ playing, not
-- a curated event (concert, dancer, multi-artist party, or a genre-only format
-- night). The agentbox linker (link_djs.py) classifies those: an event with
-- EXACTLY ONE artist that matches a row in `djs` is a DJ night. It hides that
-- event card (is_dj_set) and surfaces the DJ as a Featured DJ box via an auto
-- club_dj_sets slot instead.

-- Flag on events: true = "this is really just a DJ, not an event". The app
-- filters these out of the club's event list (they show as a DJ box instead).
alter table public.events
  add column if not exists is_dj_set boolean not null default false;

create index if not exists idx_events_dj_set on public.events (club_id, is_dj_set);

-- Provenance on the DJ-set slots so the linker only ever touches its own rows.
-- Hand-seeded / curated rows are 'manual' (the default) and are left untouched;
-- the linker deletes + rewrites only source = 'auto'.
alter table public.club_dj_sets
  add column if not exists source text not null default 'manual';
