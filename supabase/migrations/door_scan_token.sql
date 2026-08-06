-- Strong per-booking scan secret for the door scanner.
--
-- WHY a new column instead of changing qr_code_token: the existing "CF-XXXXXXXX"
-- value is a PUBLIC reference code — printed on the confirmation screen and the
-- Wallet pass. ~41 bits is fine for a human-readable reference but far too weak
-- to key the encrypted offline guest cache. The reference code is untouched; the
-- QR gets its own 128-bit secret.
--
-- Existing tickets keep working: their already-issued QRs still encode the CF-
-- code, and the door resolves those on a legacy (slow-KDF) path.
-- Apply MANUALLY in the Supabase SQL editor.

alter table public.bookings
  add column if not exists scan_token text;

-- A DEFAULT rather than app code: bookings are inserted from six different
-- routes (bookings, groups, groups/join, rumbalist confirm-vip, join-guestlist,
-- dev/test-booking). A column default means every path gets a token with no way
-- to forget one. gen_random_uuid() is core in PG13+ (no pgcrypto needed) and
-- carries 122 bits of entropy — ample as a key, and unguessable.
alter table public.bookings
  alter column scan_token set default upper(replace(gen_random_uuid()::text, '-', ''));

-- Backfill existing rows so tonight's already-booked guests get offline entries.
update public.bookings
set scan_token = upper(replace(gen_random_uuid()::text, '-', ''))
where scan_token is null;

-- The door's lookup key — collisions must be impossible.
create unique index if not exists bookings_scan_token_idx
  on public.bookings(scan_token) where scan_token is not null;
