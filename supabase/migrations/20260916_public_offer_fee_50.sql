-- The public-offer take rate becomes 50%. Private events stay at 12%.
--
-- Apply MANUALLY in the Supabase SQL editor. Idempotent.
--
-- Two rates, two different deals (see 20260822_split_fee_by_event_kind.sql):
--
--   platform_fee_bps         PRIVATE event — the promoter's own crowd through
--                            their own link. We supply the rails: 12%.
--   platform_fee_public_bps  PUBLIC offer — listed in the app. We supply the
--                            audience and the discovery: 50%.
--
-- 20260822 created platform_fee_public_bps with a default of 1200, which was
-- only ever a placeholder copied from the private rate. This sets the real one.
--
-- SCOPE: the column DEFAULT (what a new promoter starts on) and the existing
-- rows still sitting on the old 1200 placeholder. A promoter whose public rate
-- was deliberately set to something else is NOT touched — a negotiated deal
-- outranks a default, and this migration must not quietly overwrite one.
--
-- That leaves one ambiguity it cannot resolve on its own: an account genuinely
-- negotiated to 12% on public offers is indistinguishable from one that never
-- moved off the placeholder. At the time of writing there are two payout
-- accounts, one already on 5000 and one on the 1200 placeholder, and neither
-- has a public-rate deal — so the rewrite below is safe. Check that again
-- before re-running this on a larger roster.

alter table public.promoter_payout_accounts
  alter column platform_fee_public_bps set default 5000;

update public.promoter_payout_accounts
   set platform_fee_public_bps = 5000,
       updated_at = now()
 where platform_fee_public_bps = 1200
   and fee_note_public is null;   -- a note means someone decided this on purpose

comment on column public.promoter_payout_accounts.platform_fee_public_bps is
  'Basis points we take from a PUBLIC offer''s ticket sales. 5000 = 50%.';

comment on column public.promoter_payout_accounts.platform_fee_bps is
  'Basis points we take from a PRIVATE event''s ticket sales. 1200 = 12%.';
