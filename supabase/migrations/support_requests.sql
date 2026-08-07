-- Customer-service intake from the consumer app's Help button.
-- Apply MANUALLY in the Supabase SQL editor (prod drifts from /migrations).
--
-- Deliberately minimal: one row per report, with enough context (booking, venue,
-- night) that support can act without asking the guest to repeat themselves.
-- Status is a plain text check rather than an enum so adding a state later
-- doesn't need a type migration.

create table if not exists public.support_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete set null,
  booking_id   uuid references public.bookings(id) on delete set null,
  club_id      uuid references public.clubs(id) on delete set null,
  night_date   date,
  topic        text not null,          -- refused | qr | details | charge | queue | other
  message      text,
  contact_email text,
  app          text default 'clubfuoco',
  status       text not null default 'open' check (status in ('open','in_progress','resolved')),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists support_requests_status_idx  on public.support_requests(status, created_at desc);
create index if not exists support_requests_booking_idx on public.support_requests(booking_id);

alter table public.support_requests enable row level security;

-- The app posts through an authenticated API route that uses the service role,
-- so no policies are needed; nothing else should read these.
