-- Booking hardening (docs/booking-edge-cases.md, BK-06 / BK-08 / BK-17).
--
-- Apply MANUALLY in the Supabase SQL editor (production drifts from this folder).
-- Validated locally: FIXTURE=scripts/sql-fixtures/booking-hardening.sql \
--   scripts/validate-migration.sh 20261005_booking_hardening
-- Safe to run twice. Production had 0 bookings with a payment intent on
-- 2026-10-05, so the unique index cannot fail on existing rows.

-- ── 1. One booking per payment ──────────────────────────────────────────────
-- A paid VIP table is written by /api/rumbalist/confirm-vip AND, as a
-- backstop, by the Stripe webhook (lib/vip-booking). If both run at once,
-- this makes the second insert fail (23505) and read the first one's row,
-- instead of booking the table twice.
create unique index if not exists bookings_stripe_payment_intent_uniq
  on public.bookings (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ── 2. 'disputed' payment status ────────────────────────────────────────────
-- A chargeback revokes entry like a refund does (lib/refunds), but is not a
-- refund. Every admit check refuses pending/refunded/disputed. Until this
-- runs, the webhook falls back to writing 'refunded'.
--
-- The constraint is found by what it checks, not by name — production's may
-- not be called what 20260820_paid_events.sql called it.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.promoter_guests'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%payment_status%'
  loop
    execute format('alter table public.promoter_guests drop constraint %I', c.conname);
  end loop;
  alter table public.promoter_guests
    add constraint promoter_guests_payment_status_ck
    check (payment_status in ('free', 'pending', 'paid', 'refunded', 'disputed'));
end $$;

-- ── 3. Refunds that didn't go through ───────────────────────────────────────
-- DELETE /api/bookings/:id cancels the booking even when Stripe refuses the
-- refund, and used to promise "processed manually" with nothing recording it.
-- Now it writes a row here. Open rows = money owed back. Service role only.
create table if not exists public.refund_failures (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid references public.bookings(id) on delete set null,
  user_id           uuid references public.users(id) on delete set null,
  payment_intent_id text not null,
  amount_cents      integer not null check (amount_cents >= 0),
  error             text,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index if not exists refund_failures_open_idx
  on public.refund_failures (created_at) where resolved_at is null;

alter table public.refund_failures enable row level security;
-- RLS on with no policies: service role only.

comment on table public.refund_failures is
  'Refunds Stripe refused when a booking was cancelled. resolved_at null = still owed to the guest.';
