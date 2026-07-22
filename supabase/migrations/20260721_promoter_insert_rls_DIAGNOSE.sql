-- DIAGNOSTIC ONLY — this file changes nothing. Run it in the SQL editor and
-- send back the output; the fix depends on what's actually there.
--
-- Symptom: creating a guestlist in the promoter app fails with
--   42501 "new row violates row-level security policy for table promoter_nights"
-- Confirmed by reproducing the insert as an authenticated user, including one
-- with users.account_kind = 'promoter'. SELECT works on all three promoter
-- tables; INSERT is refused on all three. No promoter_nights row has been
-- created since 2026-07-09 — the review-hold migration landed 2026-07-13.

-- 1. Which policies exist, and what do they actually require?
select tablename,
       policyname,
       cmd,
       roles,
       qual        as using_expression,
       with_check  as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in ('promoter_nights', 'promoter_allocations', 'promoter_series')
order by tablename, cmd, policyname;

-- 2. Is RLS enabled (and forced) on each table?
select relname,
       relrowsecurity  as rls_enabled,
       relforcerowsecurity as rls_forced
from pg_class
where oid in ('public.promoter_nights'::regclass,
              'public.promoter_allocations'::regclass,
              'public.promoter_series'::regclass);

-- 3. Do the `authenticated` and `anon` roles even hold table grants? RLS can
--    only narrow what GRANT allows — a missing INSERT grant looks identical
--    to a failing policy from the client's side.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('promoter_nights', 'promoter_allocations', 'promoter_series')
  and grantee in ('authenticated', 'anon')
order by table_name, grantee, privilege_type;

-- 4. Triggers on insert — the review hold rewrites the row (is_published =
--    false, review_status = 'pending') BEFORE the policy's WITH CHECK runs, so
--    a check that expects is_published = true would now always fail.
select event_object_table as table_name,
       trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('promoter_nights', 'promoter_allocations', 'promoter_series')
order by table_name, trigger_name;
