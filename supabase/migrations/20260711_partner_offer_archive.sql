-- Offer archiving: deactivate an offer without deleting it, so its terms are
-- kept (seasonal offers, renegotiations) while it's hidden from the front
-- page. Public reads filter to active; the portal sees and toggles everything.
-- Run in the SQL editor (production drifts from local DDL — apply manually).

alter table public.partner_offers
  add column if not exists is_active boolean not null default true;
