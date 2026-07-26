-- Total ticket capacity for a public offer.
--
-- NOT APPLIED — run in the SQL editor.
--
-- How many tickets/spots the offer may issue per night. NULL = no limit (the
-- default and every existing offer). Enforced server-side in
-- /api/rumbalist/join-guestlist: once the night's confirmed bookings reach
-- capacity, further joins are refused.
--
-- Backward compatible: a missing column reads as NULL (no limit) in the
-- drift-defensive select('*') mappers, so nothing changes until an offer sets
-- a cap.

alter table public.partner_offers
  add column if not exists capacity int;

comment on column public.partner_offers.capacity is
  'Max tickets the offer issues per night. NULL = unlimited. Enforced at join time.';

-- Verify:
--   select id, title, kind, capacity from public.partner_offers where capacity is not null;
