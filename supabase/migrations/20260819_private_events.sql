-- Private events — schema for link-only nights, a night-scoped admission
-- ledger, and the promoter-set door code that gates scanners.
--
-- Apply MANUALLY in the Supabase SQL editor (production drifts from this
-- folder). Every statement is idempotent.
--
-- Payments for private events land in a SEPARATE migration: this one adds no
-- money columns, so it can ship and be verified before a card is ever involved.

-- ── 1. The admission ledger has to work without a club ───────────────────────
--
-- admission_scans.club_id was NOT NULL, and /api/door/admit's tokenContext()
-- bails out with a 404 whenever a guest's night has no club_id:
--
--   if (!night?.club_id || !night?.night_date) return null
--
-- promoter_nights.club_id is nullable — custom locations are a first-class
-- feature — so today a guestlist at a warehouse or a roof RESOLVES at the door
-- and then fails on admit. Private events are overwhelmingly at custom
-- locations, so this is load-bearing for everything below.
--
-- The fix keys the ledger on the night when there is no venue. Club-hosted
-- nights keep writing club_id exactly as they do now, so no existing row, index
-- or query changes meaning.

alter table public.admission_scans
  alter column club_id drop not null;

alter table public.admission_scans
  add column if not exists night_id uuid references public.promoter_nights(id) on delete cascade;

-- A scan must be attributable to SOMETHING, or it can never be counted again.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admission_scans_scope_ck'
  ) then
    alter table public.admission_scans
      add constraint admission_scans_scope_ck
      check (club_id is not null or night_id is not null);
  end if;
end $$;

create index if not exists admission_scans_night_idx
  on public.admission_scans(night_id, night_date) where night_id is not null;

-- ── 2. Private nights ────────────────────────────────────────────────────────
--
-- 'public'  — today's behaviour: eligible for the feed, discoverable.
-- 'private' — link-only. Never in explore, never in a shelf, never in search.
--             The invite token is the only way in, and the door is code-gated.
--
-- Defaulting to 'public' means every existing night keeps its current
-- behaviour with no backfill.

alter table public.promoter_nights
  add column if not exists visibility text not null default 'public';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'promoter_nights_visibility_ck'
  ) then
    alter table public.promoter_nights
      add constraint promoter_nights_visibility_ck
      check (visibility in ('public','private'));
  end if;
end $$;

create index if not exists promoter_nights_private_idx
  on public.promoter_nights(visibility, night_date) where visibility = 'private';

-- A series is private or public as a whole; materialized nights inherit it.
alter table public.promoter_series
  add column if not exists visibility text not null default 'public';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'promoter_series_visibility_ck'
  ) then
    alter table public.promoter_series
      add constraint promoter_series_visibility_ck
      check (visibility in ('public','private'));
  end if;
end $$;

-- ── 2b. …and private means private FROM OTHER PROMOTERS ──────────────────────
--
-- promoter_nights never reaches a public surface — explore is built from
-- places/offers/guest_lists, and the consumer app doesn't read the table at
-- all — so a promoter night is already link-only. The real exposure is
-- sideways. The policy from 20260721 reads:
--
--   using (<caller is a promoter> and (is_published = true or created_by = auth.uid()))
--
-- Every promoter can select every PUBLISHED night. That is deliberate for
-- ordinary nights, and wrong for a private event, whose whole premise is that
-- only the people holding the link know it is happening.
--
-- Three ways in, and all three are load-bearing:
--   created_by       — the author, including their own not-yet-approved night.
--                      This branch exists because RLS re-checks the row at
--                      INSERT … RETURNING time; without it, creation 42501s.
--   own allocation   — a night materialized from a series by the SERVICE ROLE
--                      has created_by = null, so its owner would otherwise be
--                      locked out of their own private event.
--   published+public — the shared pool, unchanged from today.
--
-- The allocation check goes through a SECURITY DEFINER function rather than an
-- inline subquery. A policy on promoter_nights that selects from
-- promoter_allocations runs that table's OWN policies; if any of them reads
-- back from promoter_nights, Postgres raises "infinite recursion detected in
-- policy for relation" and every promoter loses night reads at once.
-- promoter_allocations' policies live only in the production SQL editor, not in
-- this folder, so that is unverifiable from here — and this is the standard way
-- to make the question moot. SET search_path so the definer rights can't be
-- aimed at a shadowed table.
create or replace function public.promoter_owns_night(n_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.promoter_allocations a
    where a.night_id = n_id and a.promoter_id = auth.uid()
  );
$$;

revoke all on function public.promoter_owns_night(uuid) from public;
grant execute on function public.promoter_owns_night(uuid) to authenticated;

drop policy if exists "promoters read nights" on public.promoter_nights;
create policy "promoters read nights"
  on public.promoter_nights for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.is_promoter = true)
    and (
      created_by = auth.uid()
      or public.promoter_owns_night(id)
      or (is_published = true and coalesce(visibility, 'public') = 'public')
    )
  );

-- ── 3. Door codes ────────────────────────────────────────────────────────────
--
-- WHY A SEPARATE TABLE, not a promoter_nights column: the read policy on
-- promoter_nights is
--
--   using (<caller is a promoter> and (is_published = true or created_by = auth.uid()))
--
-- so ANY promoter can select ANY published night's row. A door_code column
-- there would be readable by every other promoter on the platform — the exact
-- people who must not have it. Codes therefore live in their own table, read-
-- own-only, written exclusively through the service role.
--
-- Scoped to a night OR a series, mirroring promoter_referrals: a recurring
-- private event should not hand its door team a new code every week.

create table if not exists public.promoter_door_codes (
  id          uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.users(id) on delete cascade,
  night_id    uuid references public.promoter_nights(id) on delete cascade,
  series_id   uuid references public.promoter_series(id) on delete cascade,
  code        text not null,
  rotated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint promoter_door_codes_scope_ck check (night_id is not null or series_id is not null)
);

-- The door types ONLY the code — no night id, no venue — so a live code must
-- identify exactly one event. The unambiguous alphabet below has 31 symbols, so
-- a 6-character code is 31^6 ≈ 8.9e8 combinations; the generator retries on the
-- (vanishingly rare) collision, and redemption is rate-limited so the space is
-- never worth walking.
create unique index if not exists promoter_door_codes_code_idx
  on public.promoter_door_codes(code);
create unique index if not exists promoter_door_codes_night_idx
  on public.promoter_door_codes(night_id) where night_id is not null;
create unique index if not exists promoter_door_codes_series_idx
  on public.promoter_door_codes(series_id) where series_id is not null;

alter table public.promoter_door_codes enable row level security;

drop policy if exists "promoter reads own door codes" on public.promoter_door_codes;
create policy "promoter reads own door codes" on public.promoter_door_codes
  for select using (promoter_id = auth.uid());
-- No insert/update/delete policy: rotation goes through a service-role route
-- that also revokes live sessions, and a direct write would skip that.

-- Codes are minted by generateDoorCode() in src/lib/door-events.ts — with
-- rejection sampling over the 31-symbol alphabet, and a retry loop against the
-- unique index above. No SQL generator: a second implementation of the same
-- alphabet is a second place for it to drift.

-- ── 4. Door sessions ─────────────────────────────────────────────────────────
--
-- Redeeming a code mints a bearer token scoped to ONE night. This is the same
-- posture as door_devices (RLS on, no policies — service role only), but bound
-- to an event rather than to a venue, because a private event's door is the
-- promoter's to control and may not be at a club at all.
--
-- expires_at is set to the night's end + 12h, matching the ceiling the door app
-- already enforces on its offline cache: a scanner that walks away from a
-- private event stops being able to admit anyone by the next afternoon.

create table if not exists public.door_event_sessions (
  id           uuid primary key default gen_random_uuid(),
  night_id     uuid not null references public.promoter_nights(id) on delete cascade,
  code_id      uuid references public.promoter_door_codes(id) on delete cascade,
  token_hash   text not null,
  label        text,
  device_model text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);

create index if not exists door_event_sessions_token_idx
  on public.door_event_sessions(token_hash);
create index if not exists door_event_sessions_night_idx
  on public.door_event_sessions(night_id) where revoked_at is null;

alter table public.door_event_sessions enable row level security;

-- ── 5. Install handoff tickets ───────────────────────────────────────────────
--
-- The probabilistic half of "the invite survives the App Store". The web page
-- records a ticket before sending someone to the store; the app claims it on
-- first launch by presenting the same coarse fingerprint.
--
-- Deliberately holds NO personal data — a hashed IP, a platform string and a
-- UA family. It is a hint, not an identity, and what it unlocks is a
-- PRE-FILLED invite screen, never a claimed spot. That containment is what
-- makes an imperfect match acceptable: two people behind one carrier NAT can
-- cross, and the worst outcome is an event page someone didn't ask for.

create table if not exists public.invite_handoffs (
  id           uuid primary key default gen_random_uuid(),
  token        text not null,                 -- the /i/<token> invite token
  fingerprint  text not null,                 -- sha256(ip + platform + ua family)
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  claimed_at   timestamptz
);

-- Claim reads the newest unclaimed, unexpired ticket for a fingerprint.
create index if not exists invite_handoffs_lookup_idx
  on public.invite_handoffs(fingerprint, created_at desc) where claimed_at is null;
create index if not exists invite_handoffs_expiry_idx
  on public.invite_handoffs(expires_at);

alter table public.invite_handoffs enable row level security;
-- Service role only: the routes authenticate the caller themselves.
