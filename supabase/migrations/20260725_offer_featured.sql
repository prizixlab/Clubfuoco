-- Featured (front-screen) public offers + their per-night billing ledger.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Mirrors the private-event front-page promotion (promoter_nights.featured +
-- promoter_billing_charges) for PUBLIC offers, so any promoter can put their
-- guestlist/VIP offer on the front screen — same €0.30-per-accepted-guest rate.
--
-- A private event is one dated night, billed 7 days after. A public offer is
-- continuous (runs every valid night with no end), so it's billed PER NIGHT it
-- ran: 7 days after each night, count the guests who booked that offer that
-- night, charge €0.30 each. One charge row per (offer, night) — idempotent.
--
-- Backward compatible: `featured` defaults false (a missing column reads as
-- not-featured in the drift-defensive select('*') mappers), so nothing changes
-- until an offer opts in.

alter table public.partner_offers
  add column if not exists featured boolean not null default false;

create table if not exists public.partner_offer_billing_charges (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references public.partner_offers(id) on delete cascade,
  brand_id       uuid references public.partner_brands(id) on delete set null,
  -- The brand owner (partner_brands.owner_user_id) — the account whose saved
  -- card is charged. Reuses promoter_billing_accounts, keyed by user_id.
  promoter_id    uuid not null references public.users(id) on delete cascade,
  event_date     date not null,
  accepted_count int  not null default 0,
  amount_cents   int  not null default 0,
  rate_cents     int  not null default 30,
  due_at         timestamptz not null,
  status         text not null default 'pending',   -- pending | charged | failed | waived
  charged_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (offer_id, event_date)
);

create index if not exists partner_offer_billing_charges_promoter_idx
  on public.partner_offer_billing_charges(promoter_id);

-- Billing ledger: written/read only by the service role (cron + offers API),
-- which bypasses RLS. Enable RLS with NO policies so anon/authenticated clients
-- get nothing — same lockdown as promoter_billing_charges.
alter table public.partner_offer_billing_charges enable row level security;

comment on column public.partner_offers.featured is
  'Paid front-screen promotion: the offer is pinned into the consumer app hero tier and billed €0.30 per accepted guest per night it ran (see partner_offer_billing_charges).';

-- Verify:
--   select id, title, featured from public.partner_offers where featured;
--   select * from public.partner_offer_billing_charges order by created_at desc limit 20;
