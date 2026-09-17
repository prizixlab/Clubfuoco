-- Door price: what you pay at the door with no guestlist and no table.
--
-- `clubs.general_entry_price` is a single number and renders as "€15+". Real
-- door prices are not one number:
--
--   Sutton    €20 flat
--   Downtown  €15–20 midweek, €22–25 at the weekend
--
-- A single column can only hold the cheapest of those, which then reads as the
-- price on a Saturday and is wrong by ten euros at the one moment somebody is
-- deciding whether to walk in.
--
-- Four columns rather than a jsonb blob: they are edited one field at a time in
-- the portal, filtered on ("free entry" chips), and compared numerically. A
-- blob would need parsing at every one of those sites.
--
--   door_price_min           required floor. 0 means free.
--   door_price_max           null = flat price, not a range.
--   door_price_weekend_min   null = the same price all week.
--   door_price_weekend_max   null = flat at the weekend.
--
-- "Weekend" is Fri/Sat nights, which is how a Barcelona door prices itself.
--
-- general_entry_price is LEFT IN PLACE and kept in step by the trigger below,
-- so every existing reader (the explore "free" filter, the booking default,
-- the old place page) keeps working with no change. It holds the floor — the
-- honest "from" price.

alter table public.clubs
  add column if not exists door_price_min         numeric(7,2),
  add column if not exists door_price_max         numeric(7,2),
  add column if not exists door_price_weekend_min numeric(7,2),
  add column if not exists door_price_weekend_max numeric(7,2);

-- A max below its min is a typo, not a price.
alter table public.clubs drop constraint if exists clubs_door_price_range_ck;
alter table public.clubs add constraint clubs_door_price_range_ck check (
  (door_price_max is null or door_price_min is null or door_price_max >= door_price_min)
  and (door_price_weekend_max is null or door_price_weekend_min is null
       or door_price_weekend_max >= door_price_weekend_min)
);

-- Keep the legacy column as the floor, so nothing that reads it has to change.
create or replace function public.sync_general_entry_price()
returns trigger
language plpgsql
as $$
begin
  if new.door_price_min is not null then
    new.general_entry_price := new.door_price_min;
  end if;
  return new;
end $$;

drop trigger if exists clubs_door_price_sync on public.clubs;
create trigger clubs_door_price_sync
  before insert or update of door_price_min on public.clubs
  for each row execute function public.sync_general_entry_price();

comment on column public.clubs.door_price_min is
  'Door price floor in EUR. 0 = free entry. Mirrored into general_entry_price.';
comment on column public.clubs.door_price_weekend_min is
  'Fri/Sat door price. Null = same as the rest of the week.';
