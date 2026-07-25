-- Conflict rules per venue, per product kind, AND per weekday.
--
-- NOT APPLIED — run in the SQL editor.
--
-- A rule can now target a specific night: Rumba runs the door Mon–Fri, Aashi on
-- Saturday. The key becomes (club_id, kind, weekday).
--
-- weekday '*' = every night (the default and what every existing row keeps).
-- '0'..'6' = Sun..Sat (matching valid-days.weekdayOf). Resolution precedence in
-- the app: (kind, day) > (kind, all-nights) > (any-kind, day) > (any-kind, all).
--
-- Backward compatible: existing rows get weekday '*', so nothing changes until
-- a day-specific rule is added. The app narrows each offer's valid_days to the
-- nights its supplier is permitted, so per-day conflicts take effect with NO
-- client change (the apps already filter offers by valid_days per night).

alter table public.club_offer_visibility
  add column if not exists weekday text not null default '*';

-- Re-key from (club_id, kind) to (club_id, kind, weekday).
do $$
declare pk text;
begin
  select conname into pk from pg_constraint
   where conrelid = 'public.club_offer_visibility'::regclass and contype = 'p';
  if pk is not null then
    execute format('alter table public.club_offer_visibility drop constraint %I', pk);
  end if;
end $$;

delete from public.club_offer_visibility a
 using public.club_offer_visibility b
 where a.ctid < b.ctid
   and a.club_id = b.club_id and a.kind = b.kind and a.weekday = b.weekday;

alter table public.club_offer_visibility
  add constraint club_offer_visibility_pkey primary key (club_id, kind, weekday);

comment on column public.club_offer_visibility.weekday is
  'Night this rule governs: ''*'' (every night) or ''0''..''6'' (Sun..Sat). A day-specific row wins over the all-nights row for the same kind.';

-- Verify:
--   select club_id, kind, weekday, mode, cardinality(brand_ids)
--     from public.club_offer_visibility order by club_id, kind, weekday;
