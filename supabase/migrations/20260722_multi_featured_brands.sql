-- Allow more than one FEATURED supplier.
--
-- NOT APPLIED — run in the SQL editor.
--
-- partner_brands.is_active names the brand that app versions too old to read
-- per-offer branding fall back to. A partial unique index made it exclusive,
-- so featuring one supplier un-featured the other and the Partners page could
-- never show two suppliers active at once.
--
-- Nothing consumer-facing depends on it any more: offers carry their own
-- brand, getPartnerOffersByClub gates on offers_hidden + club_offer_visibility,
-- and the booking sheet credits the brand on the offer being booked. So the
-- exclusivity buys nothing and costs a confusing UI.
--
-- Safe to run more than once, and safe to run before or after the matching
-- deploy: getActiveBrand() already tolerates zero, one, or many featured rows,
-- and setBrandFeatured() falls back to unset-then-set while this index exists.

-- The index name has drifted between environments, so find it rather than
-- assume it: any UNIQUE index on partner_brands that mentions is_active.
do $$
declare
  r record;
begin
  for r in
    select i.relname as index_name
      from pg_index x
      join pg_class  i on i.oid = x.indexrelid
      join pg_class  t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'partner_brands'
       and x.indisunique
       and pg_get_indexdef(x.indexrelid) ilike '%is_active%'
  loop
    raise notice 'dropping unique index %', r.index_name;
    execute format('drop index if exists public.%I', r.index_name);
  end loop;
end $$;

-- Same shape as a constraint rather than a bare index, in case it was added
-- that way in one environment.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'partner_brands'
       and c.contype = 'u'
       and pg_get_constraintdef(c.oid) ilike '%is_active%'
  loop
    raise notice 'dropping unique constraint %', r.conname;
    execute format('alter table public.partner_brands drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- set_active_brand() unsets every other brand, which is exactly the behaviour
-- being removed. The app no longer calls it (see setBrandFeatured); drop it so
-- nothing can reintroduce exclusivity behind the app's back.
drop function if exists public.set_active_brand(uuid);
drop function if exists public.set_active_brand(brand uuid);

-- Verify: this should now be able to return more than one row.
--   select key, name, is_active from public.partner_brands where is_active;
