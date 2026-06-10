-- Per-member custom payment amounts for group bookings.
-- Run this if booking_groups was already created without amount_due
-- (it's also folded into booking_groups.sql for fresh installs).
ALTER TABLE public.booking_group_members
  ADD COLUMN IF NOT EXISTS amount_due numeric;
