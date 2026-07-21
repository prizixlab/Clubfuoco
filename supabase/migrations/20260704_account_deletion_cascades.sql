-- ============================================================
-- Account deletion: fix FK actions that block deleting a user
-- Run this in: Supabase Dashboard → SQL Editor
-- ------------------------------------------------------------
-- POST /api/account/delete 500s for any user who has ever booked:
-- several production tables reference users(id) with NO ACTION
-- (verified in production 2026-07-04: booking_group_members,
-- booking_groups, rumbalist_purchases, bookings, memberships,
-- promoter_guests.claimed_by_user — and possibly more).
--
-- Production has drifted from the checked-in DDL (booking_groups /
-- rumbalist_purchases already say CASCADE in this repo yet blocked
-- in prod; promoter_guests has no local migration at all), so this
-- does NOT assume constraint names or table lists. It walks the
-- live catalog instead:
--
--   Starting from users, every single-column FK on the delete
--   path that is NO ACTION / RESTRICT is recreated as
--     · ON DELETE CASCADE   when the referencing column is NOT NULL
--       (the row is meaningless without the user: bookings,
--        memberships, group memberships, purchases, …)
--     · ON DELETE SET NULL  when the column is nullable
--       (audit/attribution links that should outlive the user:
--        promoter_guests.claimed_by_user, bookings.checked_in_by,
--        clubs.owner_user_id, live_status.updated_by, …)
--
--   Tables reached via CASCADE are processed recursively, so a
--   cascade can never dead-end in a NO ACTION FK further down
--   (e.g. users → bookings → rumbalist_purchases.booking_id, or
--   users → booking_groups → booking_group_members.group_id).
--
-- Only constraints on tables in the `public` schema are touched;
-- Supabase-managed auth/storage internals are left alone.
-- ============================================================

do $$
declare
  todo regclass[] := array['public.users'::regclass, 'auth.users'::regclass];
  seen regclass[] := array['public.users'::regclass, 'auth.users'::regclass];
  tbl  regclass;
  fk   record;
  act  text;
begin
  while cardinality(todo) > 0 loop
    tbl  := todo[1];
    todo := todo[2:];

    for fk in
      select con.conname,
             con.conrelid::regclass as child,
             con.confdeltype,
             att.attname            as col,
             refatt.attname         as refcol,
             att.attnotnull
        from pg_constraint con
        join pg_class     rel    on rel.oid = con.conrelid
        join pg_namespace ns     on ns.oid  = rel.relnamespace
        join pg_attribute att    on att.attrelid = con.conrelid
                                and att.attnum   = con.conkey[1]
        join pg_attribute refatt on refatt.attrelid = con.confrelid
                                and refatt.attnum   = con.confkey[1]
       where con.contype   = 'f'
         and con.confrelid = tbl
         and ns.nspname    = 'public'
         and cardinality(con.conkey) = 1
    loop
      if fk.confdeltype in ('a', 'r') then        -- NO ACTION / RESTRICT: fix
        act := case when fk.attnotnull then 'cascade' else 'set null' end;
        execute format('alter table %s drop constraint %I', fk.child, fk.conname);
        execute format(
          'alter table %s add constraint %I foreign key (%I) references %s(%I) on delete %s',
          fk.child, fk.conname, fk.col, tbl, fk.refcol, act);
        raise notice 'rewrote  %.% -> %  on delete %', fk.child, fk.col, tbl, act;
      elsif fk.confdeltype = 'c' then             -- already cascades: follow it
        act := 'cascade';
      else                                        -- set null/default: no deletes below
        continue;
      end if;

      if act = 'cascade' and not (fk.child = any(seen)) then
        seen := seen || fk.child;
        todo := todo || fk.child;
      end if;
    end loop;
  end loop;
end $$;

-- Final state: every FK pointing at users, with its delete rule.
-- Everything should read CASCADE or SET NULL.
select con.conrelid::regclass as "table",
       att.attname            as "column",
       case con.confdeltype
         when 'c' then 'CASCADE'
         when 'n' then 'SET NULL'
         when 'a' then 'NO ACTION'
         when 'r' then 'RESTRICT'
         when 'd' then 'SET DEFAULT'
       end as on_delete
  from pg_constraint con
  join pg_class     rel on rel.oid = con.conrelid
  join pg_namespace ns  on ns.oid  = rel.relnamespace
  join pg_attribute att on att.attrelid = con.conrelid
                       and att.attnum   = con.conkey[1]
 where con.contype = 'f'
   and ns.nspname  = 'public'
   and con.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
 order by 1, 2;
