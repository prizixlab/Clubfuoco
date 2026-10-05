-- Partner API credentials — per-promoter keys for third-party platforms.
--
-- Apply MANUALLY in the Supabase SQL editor (production drifts from this folder).
--
-- WHY THIS EXISTS: HypeList run their events on Fourvenues, and the deal is that
-- a Club Fuoco booking must produce a real Fourvenues ticket. That needs THEIR
-- API key, held by us. Xceed and DICE are the same shape, so nothing here says
-- "fourvenues" in a column name — the provider is a value, not a schema.
--
-- ── THE ONE RULE ─────────────────────────────────────────────────────────────
-- The secret is NOT in partner_credentials. It lives in its own table, so a
-- `select *` on the metadata — a portal list, a debug log, a join someone
-- writes in six months — cannot return it.
--
-- This is not hypothetical caution. See the note on SealedEntry in
-- src/lib/door-crypto.ts: a field sitting in the clear, documented as "an
-- opaque row ref, safe to expose", turned out to be the key to its own
-- envelope, and 46 of 46 guests on a real club night decrypted out of an
-- unauthenticated GET. A secret reachable by `select *` is that bug waiting to
-- be written again.

-- ── partner_credentials ──────────────────────────────────────────────────────
-- One row per (owner, provider, kind). Metadata only: safe to list, safe to log.
create table if not exists public.partner_credentials (
  id                uuid primary key default gen_random_uuid(),

  -- Who the key belongs to. owner_id is null for 'platform' — our OWN channel
  -- key, which belongs to Club Fuoco rather than to any promoter.
  owner_type        text not null check (owner_type in ('promoter','brand','club','platform')),
  owner_id          uuid,

  provider          text not null,                 -- 'fourvenues' | 'xceed' | …
  kind              text not null,                 -- 'integrations_api' | 'channel_manager'
  label             text,                          -- 'HypeList Integrations key'

  -- Identity of the secret WITHOUT the secret: sha256 lets us answer "is this
  -- the same key you sent last time?" on a re-submission without ever
  -- comparing plaintext, and last4 is all the portal ever displays.
  fingerprint       text,
  last4             text,

  -- What we believe the key can do. Advisory: the provider enforces the truth.
  -- Stored so a 403 at 2am is diagnosable without guessing.
  scopes            text[] not null default '{}',

  status            text not null default 'pending'
                    check (status in ('pending','active','failed','revoked','expired')),

  issued_at         timestamptz,
  expires_at        timestamptz,                   -- when the provider says it dies
  rotate_after      timestamptz,                   -- when WE want it replaced

  -- Health. Silent revocation is the failure that actually hurts: a key pulled
  -- without warning is discovered by a customer who paid and got no ticket.
  -- The verify sweep writes these so we find out first.
  last_verified_at  timestamptz,
  last_verified_ok  boolean,
  last_error        text,
  last_used_at      timestamptz,

  -- Reminder bookkeeping, so a daily sweep doesn't email the same warning twice.
  last_reminder_at  timestamptz,
  reminder_stage    int,                           -- 30 | 14 | 3, days-out already sent

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text,                          -- portal operator note
  notes             text
);

-- One live credential per owner+provider+kind. Partial, so revoked/expired rows
-- stay as history instead of blocking the replacement.
create unique index if not exists partner_credentials_live_idx
  on public.partner_credentials (provider, kind, owner_type, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('pending','active','failed');

create index if not exists partner_credentials_owner_idx
  on public.partner_credentials (owner_type, owner_id);
create index if not exists partner_credentials_sweep_idx
  on public.partner_credentials (status, rotate_after)
  where status = 'active';

alter table public.partner_credentials enable row level security;
-- RLS on with no policies: service role only, same posture as door_devices.

-- ── partner_credential_secrets ───────────────────────────────────────────────
-- The ciphertext, alone in its own table. AES-256-GCM under CREDENTIAL_MASTER_KEY
-- (env, never in the database) — so a database dump without the app's env is
-- inert, and the app must ask for the secret by name to get it.
create table if not exists public.partner_credential_secrets (
  credential_id  uuid primary key
                 references public.partner_credentials(id) on delete cascade,
  iv             text not null,                    -- hex, 12 bytes
  ciphertext     text not null,                    -- hex, GCM tag appended
  key_version    int  not null default 1,          -- bump when the master key rotates
  created_at     timestamptz not null default now()
);

alter table public.partner_credential_secrets enable row level security;

-- ── credential_intake_tokens ─────────────────────────────────────────────────
-- The one-time link a promoter uses to hand us a key.
--
-- We promised this in writing: "we'll send a one-time link that expires on use."
-- An API key pasted into email or WhatsApp lives forever in two companies'
-- mailboxes; this exists so nobody has to do that.
--
-- Only the HASH of the token is stored. The link is the one copy, and if the
-- row leaks it cannot be replayed.
create table if not exists public.credential_intake_tokens (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,              -- sha256 of the URL token

  owner_type    text not null check (owner_type in ('promoter','brand','club','platform')),
  owner_id      uuid,
  provider      text not null,
  kind          text not null,

  -- Shown on the intake page so the recipient knows who is asking and for what.
  display_name  text,
  sent_to       text,                              -- the address we mailed

  expires_at    timestamptz not null,
  used_at       timestamptz,                       -- set on submit; burns the link
  revoked_at    timestamptz,                       -- operator cancelled it

  credential_id uuid references public.partner_credentials(id) on delete set null,
  created_at    timestamptz not null default now(),
  created_by    text
);

create index if not exists credential_intake_open_idx
  on public.credential_intake_tokens (owner_type, owner_id, provider)
  where used_at is null and revoked_at is null;

alter table public.credential_intake_tokens enable row level security;
