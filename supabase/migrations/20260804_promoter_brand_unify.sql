-- Promoters & suppliers are one entity: a partner_brands row owned by a
-- promoter account (owner_user_id). Phase 2 makes every approved promoter get a
-- brand on approval; this enforces that the relationship is one-to-one.
--
-- owner_user_id stays NULLable on purpose — a brand may be seeded before its
-- promoter has access (a list we're onboarding, e.g. Aashi). The partial unique
-- only binds rows that actually name an owner, so any number of owner-less
-- prospective brands is still allowed.
--
-- Manual apply (prod schema drifts from these files — paste into the SQL
-- editor). Verify no owner already holds two brands before applying:
--   select owner_user_id, count(*) from partner_brands
--   where owner_user_id is not null group by 1 having count(*) > 1;
create unique index if not exists partner_brands_owner_user_id_key
  on partner_brands (owner_user_id)
  where owner_user_id is not null;
