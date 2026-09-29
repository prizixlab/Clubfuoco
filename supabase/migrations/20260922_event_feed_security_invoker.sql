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

-- ── The ra_events view must be READ-ONLY, and this is not theoretical ───────
--
-- Added 29 Sep 2026, a week after the migration above was applied while the
-- code that goes with it was still undeployed.
--
-- The deployed /api/admin/sync-events still runs, every morning at 06:00:
--
--     delete from ra_events where event_date < now()
--
-- A Postgres view with computed columns rejects INSERT and UPDATE of those
-- columns — which is why the job's upsert now fails loudly — but DELETE is
-- still auto-updatable, and it deletes from the BASE TABLE. Reproduced on a
-- local copy: 4 events in, `delete from ra_events where event_date < now()`,
-- 1 event left, and the only row carrying a lineup gone with it.
--
-- So for a week the cron has been removing past rows from `events` each
-- morning; agentbox's ingest then re-creates the listings without provenance,
-- which is why 1676 of 1812 rows now have a null source_ref and none carry the
-- folded-in prices any more.
--
-- Blocking writes here is the belt: it makes the old job's delete a harmless
-- no-op the moment this runs, without waiting on a deploy. The braces are
-- deploying the rewritten job (it writes `events` directly and no longer
-- deletes anything) and teaching agentbox's ingest to set the provenance
-- columns. Both still to do.
--
-- DO INSTEAD NOTHING rather than RAISE: the goal is to stop the damage, not to
-- start paging someone at 06:00 over a job that is about to be replaced.

create or replace rule ra_events_no_delete as
  on delete to public.ra_events do instead nothing;
create or replace rule ra_events_no_insert as
  on insert to public.ra_events do instead nothing;
create or replace rule ra_events_no_update as
  on update to public.ra_events do instead nothing;

comment on view public.ra_events is
  'Read-only compatibility shim for the shipped iOS build and the web ticket helpers. Writes are silently discarded by rule — DELETE through this view used to remove rows from public.events. New code queries public.events directly.';
