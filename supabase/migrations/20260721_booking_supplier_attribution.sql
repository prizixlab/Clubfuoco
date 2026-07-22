-- Record WHICH supplier a booking came from, so the ticket can brand itself.
--
-- NOT APPLIED — run in the SQL editor when you want Aashi-branded tickets.
--
-- Today a booking stores no supplier at all. The wallet pass infers its brand
-- from `booking.club_id in RUMBALIST_OFFERS` — the hardcoded map. That was
-- merely stale while Rumba was the only supplier; with Aashi now covering 9 of
-- the same venues it is WRONG: a guest who joins Aashi's list at Opium gets a
-- Rumbalist-branded pink pass.
--
-- brand_id is nullable and ON DELETE SET NULL: historical bookings keep working
-- with no brand, and removing a supplier must never delete someone's ticket.

alter table public.bookings
  add column if not exists brand_id uuid references public.partner_brands(id) on delete set null;

create index if not exists bookings_brand_id_idx on public.bookings (brand_id) where brand_id is not null;

comment on column public.bookings.brand_id is
  'Supplier whose offer produced this booking. Drives ticket/wallet-pass '
  'branding. Null for bookings made before attribution existed.';
