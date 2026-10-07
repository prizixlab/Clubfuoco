-- Ticket inbox: a private email address per profile, and tickets that follow
-- the account.
--
-- Apply MANUALLY in the Supabase SQL editor (production drifts from this folder).
-- Validated locally: scripts/validate-migration.sh with FIXTURE=scripts/sql-fixtures/ticket-inbox.sql
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- HypeList nights are booked on Fourvenues, which emails the ticket. A guest
-- who signed in with Apple has a @privaterelay.appleid.com address that only
-- accepts mail from senders WE register with Apple — Fourvenues isn't one, so
-- their ticket email never arrives. Instead the app gives Fourvenues a Club
-- Fuoco address (<token>@tickets.clubfuoco.com, received by Resend), the
-- webhook at /api/inbound/resend files the ticket against the account, and a
-- copy is forwarded to the guest's real inbox from our own domain.
--
-- Tickets also stop living on one phone: external_tickets is the account's
-- record, written by the app when a sign-up or payment completes and by the
-- webhook when the email lands.

-- ── ticket_inboxes ───────────────────────────────────────────────────────────
-- One address per user. The token is random — not the user id — so the
-- address Fourvenues (and any venue mailing list) sees says nothing about the
-- account. Created on first use by GET /api/me/ticket-inbox (service role).
create table if not exists public.ticket_inboxes (
  user_id    uuid primary key references public.users(id) on delete cascade,
  token      text not null unique check (token ~ '^[a-z0-9]{10,32}$'),
  created_at timestamptz not null default now()
);

alter table public.ticket_inboxes enable row level security;

drop policy if exists "own inbox readable" on public.ticket_inboxes;
create policy "own inbox readable" on public.ticket_inboxes
  for select to authenticated using (auth.uid() = user_id);

-- ── external_tickets ─────────────────────────────────────────────────────────
-- A ticket bought or joined on a partner platform (Fourvenues today). The QR
-- payload is the platform's own door code (e.g. "LNKO1S1G1"), so the card in
-- the app scans exactly like the platform's PDF.
--
-- pdf_url opens the ticket for anyone holding it — owner-only, like a password.
create table if not exists public.external_tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  provider     text not null default 'fourvenues',
  event_code   text not null,
  event_name   text,
  venue        text,
  club_id      uuid,
  address      text,
  night        date not null,
  doors        text,
  closes       text,
  image        text,
  product_name text,
  settle       text not null check (settle in ('free', 'door', 'online', 'table')),
  unit_price   numeric(10,2) not null default 0 check (unit_price >= 0),
  heads        integer not null default 1 check (heads > 0),
  qr_payload   text,
  pdf_url      text,
  success_url  text,
  -- Who filed it: the app at sign-up/payment, or the inbox webhook.
  source       text not null default 'app' check (source in ('app', 'email')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists external_tickets_user_night_idx
  on public.external_tickets (user_id, night);

-- The same door code can't be filed twice for one account — the app and the
-- email describing the same ticket must merge, not duplicate.
create unique index if not exists external_tickets_user_qr_uniq
  on public.external_tickets (user_id, qr_payload) where qr_payload is not null;

alter table public.external_tickets enable row level security;

drop policy if exists "own tickets readable" on public.external_tickets;
create policy "own tickets readable" on public.external_tickets
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own tickets insertable" on public.external_tickets;
create policy "own tickets insertable" on public.external_tickets
  for insert to authenticated with check (auth.uid() = user_id and source = 'app');

drop policy if exists "own tickets updatable" on public.external_tickets;
create policy "own tickets updatable" on public.external_tickets
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tickets deletable" on public.external_tickets;
create policy "own tickets deletable" on public.external_tickets
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.touch_external_ticket()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists external_tickets_touch on public.external_tickets;
create trigger external_tickets_touch
  before update on public.external_tickets
  for each row execute function public.touch_external_ticket();

-- ── ticket_inbox_messages ────────────────────────────────────────────────────
-- Every email the inbox received and what became of it. Idempotency for
-- Resend's webhook retries (email_id is the key), and the place to look when
-- someone says "my ticket never showed up". Service role only.
create table if not exists public.ticket_inbox_messages (
  email_id     text primary key,
  user_id      uuid references public.users(id) on delete cascade,
  to_address   text,
  from_address text,
  subject      text,
  status       text not null check (status in ('filed', 'unknown_inbox', 'no_ticket', 'error')),
  detail       text,
  ticket_id    uuid references public.external_tickets(id) on delete set null,
  forwarded    boolean not null default false,
  received_at  timestamptz not null default now()
);

alter table public.ticket_inbox_messages enable row level security;
-- RLS on with no policies: service role only.

comment on table public.ticket_inboxes is
  'Private per-user address <token>@tickets.clubfuoco.com given to partner platforms instead of the account email.';
comment on table public.external_tickets is
  'Partner-platform tickets (Fourvenues) on the account: written by the app and by the ticket inbox webhook.';
