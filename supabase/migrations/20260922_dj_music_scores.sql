-- DJ music scores: what the morning-after survey says about who was playing.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Nobody rates a DJ in this product. People rate a NIGHT, once, the next
-- morning, with one "how was the music" star field — and a night has a venue, a
-- weekday, a crowd, and usually two names on the bill. These tables are the
-- record needed to turn that into a per-artist signal; src/lib/dj-score.ts is
-- the maths and carries the full reasoning, including what it refuses to do.
--
-- ENTIRELY INTERNAL. Nothing here is surfaced in either app. A public number
-- next to a working DJ's name, computed from a handful of responses, is how you
-- get an angry agent — and kept private it is a genuine moat, because nobody
-- else holds door-verified attendance tied to post-night sentiment. RLS is
-- enabled with NO policies on every table below, which means no anon and no
-- authenticated role can read or write them; only the service role (the cron
-- job) can. That is deliberate, not an oversight: see the note in
-- project_clubfuoco_rls_orphaned_updates about tables left with dangling
-- policies after the admin removal. If one of these ever needs to reach a
-- client, add an explicit policy then and think about it then.
--
-- WHY A NIGHT IS (club, date) AND NOT bookings.night_id: `bookings.night_id`
-- exists (FK to promoter_nights, added 20260819_private_events.sql) but is
-- populated on 0 of 81 rows, and promoter_nights only covers nights a promoter
-- sold through us — not the RA-scraped programme, which is where lineups
-- actually come from. Keying on (club_id, night_date) means every existing
-- booking is attributable today, with no backfill, and a promoter night can be
-- joined in later without moving the grain.

-- ── The night ───────────────────────────────────────────────────────────────

create table if not exists public.music_nights (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs(id) on delete cascade,
  night_date   date not null,
  -- `events.ra_event_id` when the programme scrape matched this club+date.
  -- NULL means we know people were there but not who played.
  ra_event_id  text,
  -- 0 = Sunday … 6 = Saturday, to match Date#getUTCDay and the algorithm.
  -- Denormalised because every baseline fit groups by it.
  weekday      smallint not null check (weekday between 0 and 6),
  lineup_size  smallint not null default 0 check (lineup_size >= 0),
  -- Bookings recorded for this night: the denominator for response rate.
  bookings_n   int not null default 0 check (bookings_n >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (club_id, night_date)
);

comment on table public.music_nights is
  'One row per (club, date) that has at least one booking or survey. Internal.';

-- ── Who played ──────────────────────────────────────────────────────────────

create table if not exists public.music_night_artists (
  night_id     uuid not null references public.music_nights(id) on delete cascade,
  -- Matches djs.ra_artist_id. Text, not a FK: the lineup scrape yields artists
  -- who are not in `djs` yet, and synthetic 'guest:<name>' ids for acts with no
  -- RA page at all. A hard FK would drop exactly the nights we most want.
  ra_artist_id text not null,
  -- Share of this night's credit, 0–1. The shares on a night sum to 1, so one
  -- night is always worth one night however long the bill.
  weight       numeric(6,4) not null check (weight > 0 and weight <= 1),
  -- Position on the bill, 0 = top, NULL when the scrape gave no order.
  billing      smallint check (billing >= 0),
  role         text not null default 'billed'
               check (role in ('headliner', 'support', 'resident', 'guest', 'billed')),
  primary key (night_id, ra_artist_id)
);

create index if not exists music_night_artists_artist_idx
  on public.music_night_artists(ra_artist_id);

-- ── Per-night result ────────────────────────────────────────────────────────

create table if not exists public.music_night_scores (
  night_id            uuid primary key references public.music_nights(id) on delete cascade,
  responses_n         int not null check (responses_n >= 0),
  -- Unweighted mean of vibe_rating, kept so the weighting stays auditable.
  raw_mean            numeric(5,3) not null,
  -- Review-weighted mean: what the model consumes.
  weighted_mean       numeric(5,3) not null,
  -- Sum of review weights — how many full-strength responses the night is
  -- worth. This, not responses_n, is how much the night counts.
  effective_responses numeric(8,3) not null,
  -- responses / bookings. RECORDED AND NOT USED IN THE FIT, on purpose: it is
  -- genuinely unknown whether quiet feedback means a bad night or a heavy one,
  -- and hard-coding either answer would make the output rank response rate
  -- instead of music. Here so its sign can be learned once there is data.
  response_rate       numeric(6,4),
  -- Baseline (global + club + weekday) and what the lineup added over it.
  -- NULL when the night is below the response floor and was not scored.
  expected            numeric(5,3),
  residual            numeric(5,3),
  scored              boolean not null default false,
  computed_at         timestamptz not null default now()
);

-- ── Fitted baselines, stored so they can be inspected and argued with ───────

create table if not exists public.music_baselines (
  scope       text not null check (scope in ('global', 'club', 'weekday')),
  -- '' for global, the club uuid, or the weekday number as text.
  key         text not null,
  value       numeric(6,3) not null,
  -- Effective responses behind this estimate.
  weight      numeric(10,3) not null,
  computed_at timestamptz not null default now(),
  primary key (scope, key)
);

comment on table public.music_baselines is
  'What a night at this club, on this weekday, is expected to score before the lineup is considered.';

-- ── Per-artist result ───────────────────────────────────────────────────────

create table if not exists public.dj_music_scores (
  ra_artist_id text primary key,
  nights_n     int not null check (nights_n >= 0),
  -- Distinct clubs. The guard against mistaking a room for an artist: a DJ seen
  -- at one venue cannot be told apart from that venue, however many nights.
  venues_n     int not null check (venues_n >= 0),
  responses_n  int not null check (responses_n >= 0),
  credit       numeric(10,3) not null,
  raw_residual numeric(5,3) not null,
  -- After shrinkage toward zero. THIS is the ranking key.
  effect       numeric(5,3) not null,
  -- effect expressed on the 1–5 star scale. NULL below 'medium' confidence,
  -- which means "we do not know yet" — never 0, never a plausible guess.
  score        numeric(4,2) check (score is null or score between 1 and 5),
  confidence   text not null check (confidence in ('none', 'low', 'medium', 'high')),
  computed_at  timestamptz not null default now()
);

create index if not exists dj_music_scores_rank_idx
  on public.dj_music_scores(confidence, effect desc);

-- ── Locked down ─────────────────────────────────────────────────────────────
-- RLS on, no policies: service role only. See the header.

alter table public.music_nights         enable row level security;
alter table public.music_night_artists  enable row level security;
alter table public.music_night_scores   enable row level security;
alter table public.music_baselines      enable row level security;
alter table public.dj_music_scores      enable row level security;

-- Guarded on the roles existing so this file also runs on a plain Postgres,
-- where 'anon' and 'authenticated' are not defined — that is how it gets
-- validated before being pasted into the SQL editor. On Supabase both roles
-- exist and every revoke below runs.
do $$
declare
  t text;
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      raise notice 'role % not present — skipping revoke (expected off Supabase)', r;
      continue;
    end if;
    foreach t in array array['music_nights', 'music_night_artists',
                             'music_night_scores', 'music_baselines',
                             'dj_music_scores'] loop
      execute format('revoke all on public.%I from %I', t, r);
    end loop;
  end loop;
end $$;
