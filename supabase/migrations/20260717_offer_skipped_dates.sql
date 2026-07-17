-- Per-night exceptions for a public offer. Run in the SQL editor (production
-- drifts — apply manually).
--
-- valid_days says which nights an offer NORMALLY runs ("Sun – Fri"). This is
-- the exception list: specific dates it is NOT offered, even though valid_days
-- covers them — "we're normally on Monday, but not Monday the 20th".
--
-- Mirrors promoter_series.skipped_dates, and like it this is SCHEDULING, not
-- content: toggling a night applies immediately instead of going through the
-- review queue. A promoter cancelling Monday can't wait three business days
-- for approval.
--
-- Consumers must treat an offer as unavailable on these dates: /api/partner
-- returns the array per offer, and the booking routes refuse a claim for a
-- skipped date (client filtering alone is not enforcement).

alter table public.partner_offers
  add column if not exists skipped_dates date[] not null default '{}';
