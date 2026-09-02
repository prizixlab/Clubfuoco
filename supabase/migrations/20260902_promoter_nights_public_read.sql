-- Let a guest read the events they are already allowed to see.
--
-- Apply MANUALLY in the Supabase SQL editor. Idempotent.
--
-- The bug this fixes is quiet and worth understanding, because it will happen
-- again otherwise: PostgREST returns NULL for an embedded relation the caller
-- cannot read. It does not error. So `bookings ... promoter_nights(...)`
-- came back with `promoter_nights: null` for every real user, and an event
-- ticket rendered as a plain venue booking — no event name, no line-up, doors
-- as an em-dash — while the same query run with the service role returned
-- everything. Nothing in the logs, nothing in the client.
--
-- WHAT THIS GRANTS is deliberately identical to the gate on `v_events_feed`,
-- which /api/events/feed already serves to the public with no session at all:
--
--     published + approved + public + not in the past
--
-- So this policy exposes nothing that is not already public. It does NOT open
-- private nights, unapproved submissions, unpublished drafts, or past events —
-- which is exactly why the feed route reads through the service client rather
-- than being handed a blanket SELECT.

alter table public.promoter_nights enable row level security;

drop policy if exists "guests read live public nights" on public.promoter_nights;
create policy "guests read live public nights" on public.promoter_nights
  for select
  using (
    is_published
    and review_status = 'approved'
    and visibility = 'public'
    and night_date >= (now() at time zone 'Europe/Madrid')::date
  );

-- Note the asymmetry this leaves, on purpose: a guest holding a ticket to a
-- night that has since PASSED can no longer read that night, so an old ticket
-- degrades to showing its venue and date rather than the event's name. That is
-- the right trade — a past event is not public information, and the booking
-- itself still carries everything the guest needs about a night they attended.
