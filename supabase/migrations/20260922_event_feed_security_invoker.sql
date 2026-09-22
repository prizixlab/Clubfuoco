-- The event_feed view must not launder away RLS.
--
-- NOT APPLIED — run in the SQL editor. APPLY THIS PROMPTLY: until it is
-- applied, event_feed hands anonymous callers rows that RLS on promoter_nights
-- deliberately hides.
--
-- WHAT WENT WRONG. 20260922_events_one_dataset.sql created event_feed as a
-- plain view over events + promoter_nights. In PostgreSQL a view executes with
-- the privileges of its OWNER unless `security_invoker` is set, and the owner
-- here is the migration runner — so every row-level policy on the underlying
-- tables was bypassed for anyone who could read the view. Measured on
-- production immediately after applying:
--
--   promoter_nights, read directly as anon ....... 602 rows (RLS filtered 150)
--   promoter nights, read via event_feed as anon .. 752 rows (all of them)
--
-- Including at least one night with is_public = false. The view's comment says
-- to filter is_public before showing anything to a guest, which was always the
-- wrong shape of protection: a comment is not a boundary, and the anon key can
-- simply not filter. is_public stays as presentation advice; RLS is the
-- boundary, and this restores it.
--
-- `security_invoker = true` makes the view evaluate as the CALLING role, so
-- promoter_nights' own policies apply again. Postgres 15+, which Supabase is.
--
-- ra_events gets the same treatment. There is no escalation there today — the
-- underlying `events` table is readable by anon and authenticated by policy
-- (20260719_events_ingest.sql) — but a compatibility shim that quietly runs
-- with more authority than its caller is a trap waiting for the first time
-- someone tightens events' RLS and cannot work out why it had no effect.

alter view public.event_feed set (security_invoker = true);
alter view public.ra_events  set (security_invoker = true);

-- Both views are read-only surfaces. Grant SELECT explicitly rather than
-- relying on whatever the schema's default privileges happen to be, so the
-- shipped iOS build (which reads ra_events with the anon key) keeps working
-- and the intent is written down.
grant select on public.event_feed to anon, authenticated;
grant select on public.ra_events  to anon, authenticated;
