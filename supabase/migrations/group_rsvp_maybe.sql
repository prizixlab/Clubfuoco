-- Add a 'maybe' (tentative) RSVP state to group members.
-- Run this if booking_group_members already exists (also folded into
-- booking_groups.sql for fresh installs).
ALTER TABLE public.booking_group_members
  DROP CONSTRAINT IF EXISTS booking_group_members_rsvp_check;
ALTER TABLE public.booking_group_members
  ADD CONSTRAINT booking_group_members_rsvp_check
  CHECK (rsvp IN ('invited', 'going', 'maybe', 'declined'));
