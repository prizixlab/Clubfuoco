-- Capture Eventbrite Organizer ID at verification time so the admin
-- reviewer can promote it onto the clubs row when approving.
alter table public.club_verification_requests
  add column if not exists eventbrite_organizer_id text;
