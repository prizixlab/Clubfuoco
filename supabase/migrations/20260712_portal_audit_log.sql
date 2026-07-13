-- Partner Portal audit trail: an append-only record of every operator action
-- (brand create/edit/activate, offer CRUD, club edits, supplier provisioning).
-- The portal uses a shared password, so "who" is just the operator — the value
-- is the what/which/when. Service-role only (portal writes + reads via the
-- service client); no public access.
-- Run in the SQL editor (production drifts from local DDL — apply manually).

create table if not exists public.portal_audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,            -- e.g. 'brand.activate', 'offer.delete'
  summary     text not null,            -- human-readable one-liner
  target_type text,                     -- 'brand' | 'offer' | 'club'
  target_id   uuid,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists portal_audit_log_created_idx
  on public.portal_audit_log(created_at desc);

alter table public.portal_audit_log enable row level security;
-- No policies → only the service role (portal server routes) can read/write.
