-- Promoter guestlist creation was failing with 42501 for a week.
--
-- The INSERT policy was fine. The break was the SELECT policy interacting with
-- the review-hold trigger added on 2026-07-13:
--
--   trigger  hold_promoter_submission sets is_published := false on every
--            promoter (non-service-role) insert
--   policy   "promoters read nights" required (is_published = true)
--
-- The app inserts with .select(), so PostgREST issues INSERT ... RETURNING.
-- Under RLS, RETURNING re-checks the new row against the SELECT policy — the
-- row it had just created was unpublished, the policy hid it, and Postgres
-- rejected the whole statement with 42501. Before the trigger, is_published
-- stayed true and the readback passed, which is why creation worked until
-- 2026-07-09 and never again.
--
-- Second symptom of the same policy: a promoter could never SEE their own
-- pending night, so the entire "awaiting review" flow was invisible to them.
--
-- promoter_nights had no ownership column (ownership existed only through
-- promoter_allocations, which is created AFTER the night — so it cannot help
-- at RETURNING time). Hence created_by, defaulted to auth.uid().
--
-- Service-role inserts (series materialization, portal approval) get
-- created_by = null and are published anyway, so they stay visible via the
-- is_published branch.
--
-- APPLIED 2026-07-21. Verified against production: night insert + readback,
-- allocation insert + readback, author sees their own pending night, and a
-- different promoter does NOT see it while published nights stay shared.

alter table public.promoter_nights
  add column if not exists created_by uuid references auth.users(id) default auth.uid();

drop policy if exists "promoters read nights" on public.promoter_nights;
create policy "promoters read nights"
  on public.promoter_nights for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.is_promoter = true)
    and (is_published = true or created_by = auth.uid())
  );
