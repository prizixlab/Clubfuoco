-- Conflict rules per venue AND per offer kind.
--
-- NOT APPLIED — run in the SQL editor.
--
-- One rule per venue could not express "Rumba runs the VIP tables here, Aashi
-- runs the guestlist" — picking a supplier took both kinds with it. The rule
-- key becomes (club_id, kind).
--
-- '*' is the venue-wide fallback and the default, so EVERY EXISTING ROW keeps
-- working untouched: a rule for a specific kind wins, otherwise the '*' rule
-- applies to every kind. Nothing has to be rewritten, and only the venues you
-- actually want to split need a per-kind decision.
--
-- Safe before or after the matching deploy: the app reads a row with no `kind`
-- as '*', and writes '*' until it is told otherwise.

alter table public.club_offer_visibility
  add column if not exists kind text not null default '*';

-- Re-key: club_id alone was the primary key, so a venue could hold one rule.
do $$
declare
  pk text;
begin
  select conname into pk
    from pg_constraint
   where conrelid = 'public.club_offer_visibility'::regclass
     and contype = 'p';
  if pk is not null then
    raise notice 'dropping primary key %', pk;
    execute format('alter table public.club_offer_visibility drop constraint %I', pk);
  end if;
end $$;

-- Guard against duplicates before the composite key goes on (there should be
-- none — club_id was unique — but this makes a re-run safe).
delete from public.club_offer_visibility a
 using public.club_offer_visibility b
 where a.ctid < b.ctid
   and a.club_id = b.club_id
   and a.kind    = b.kind;

alter table public.club_offer_visibility
  add constraint club_offer_visibility_pkey primary key (club_id, kind);

comment on column public.club_offer_visibility.kind is
  'Offer kind this rule governs (free_guestlist / vip_table), or ''*'' for the whole venue. A kind-specific row wins over ''*''.';

-- Verify:
--   select club_id, kind, mode, cardinality(brand_ids) from public.club_offer_visibility order by club_id, kind;
