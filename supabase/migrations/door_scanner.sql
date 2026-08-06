-- Fuoco Door scanner — Phase A schema (detection, no charging).
-- Greenfield: none of these objects existed in the live catalog as of 2026-08-05.
-- Apply MANUALLY in the Supabase SQL editor (production drifts from this folder).
--
-- Tables use RLS-enabled-with-no-policies: only the service role reaches them,
-- matching the /api/door/* routes which authenticate the device themselves and
-- query via createServiceClient() (same posture as /api/bookings/verify).

-- ── door_devices ─────────────────────────────────────────────────────────────
-- One physical door device, enrolled to a club with a revocable credential.
-- A club_staff/owner provisions a row (gets a one-time enrollment_code); the
-- device exchanges that code for a bearer token whose SHA-256 we store here.
create table if not exists public.door_devices (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null references public.clubs(id) on delete cascade,
  label                 text,
  enrollment_code       text unique,                 -- one-time; nulled on claim
  enrollment_expires_at timestamptz,
  token_hash            text,                         -- sha256(device bearer token)
  claimed_at            timestamptz,
  last_seen_at          timestamptz,
  revoked_at            timestamptz,                  -- set to revoke a lost device
  created_by            uuid references public.users(id),
  created_at            timestamptz not null default now()
);

create index if not exists door_devices_club_idx      on public.door_devices(club_id);
create index if not exists door_devices_token_idx      on public.door_devices(token_hash) where token_hash is not null;
create unique index if not exists door_devices_code_idx on public.door_devices(enrollment_code) where enrollment_code is not null;

alter table public.door_devices enable row level security;

-- ── admission_scans ──────────────────────────────────────────────────────────
-- The de-duplicated admission ledger — the signal the overscan clause needs.
-- `scan_id` is the client-generated idempotency key: the same physical scan,
-- retried across syncs or reconciled from two offline doors, collapses to ONE
-- row. `action` = admit | void; net admitted heads for a token = sum(admit) -
-- sum(void). `billable` excludes free guestlist from overscan (per the Terms).
create table if not exists public.admission_scans (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid not null unique,               -- client idempotency key
  door_device_id  uuid references public.door_devices(id) on delete set null,
  club_id         uuid not null references public.clubs(id) on delete cascade,
  night_date      date not null,
  token_ref       text not null,                      -- bk_<id> | pg_<id> | …
  credential_kind text not null,                      -- paid_entry|vip_table|guestlist|ticket|membership
  action          text not null check (action in ('admit','void')),
  count           integer not null default 1 check (count > 0),
  billable        boolean not null default true,
  holder_name     text,
  reason          text,
  device_time     timestamptz,
  server_time     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists admission_scans_night_idx on public.admission_scans(club_id, night_date);
create index if not exists admission_scans_token_idx on public.admission_scans(club_id, night_date, token_ref);

alter table public.admission_scans enable row level security;

-- ── bookings.admissions_allowed ──────────────────────────────────────────────
-- Decouples the door allowance from party_size so a booking's admit ceiling can
-- differ from the party count if ever needed. The manifest reads
-- COALESCE(admissions_allowed, party_size), so leaving it NULL keeps today's
-- behaviour (allowance == party_size).
alter table public.bookings
  add column if not exists admissions_allowed integer;
