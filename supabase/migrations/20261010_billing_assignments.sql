-- Billing: the operator assigns a promoter to an "event" (a club on a night)
-- whose app entries have no promoter of their own — old offer bookings made
-- before bookings carried a brand. Only fills gaps: an entry that already has
-- a promoter (brand, night creator, allocation, Fourvenues seller) keeps it.
--
-- Kept apart from bookings.brand_id on purpose: that column drives partner
-- confirmation and what a promoter sees in their app, and back-filling it
-- would surface months-old bookings there. This is billing-only and undoable.
--
-- Service-role only (the portal); RLS on, no policies.

create table if not exists public.billing_assignments (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null,
  night      date not null,
  brand_id   uuid not null references public.partner_brands (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (club_id, night)
);

alter table public.billing_assignments enable row level security;
