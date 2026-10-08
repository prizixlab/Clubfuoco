-- Twin tickets: every admitted ticket on one allocation gets a free twin ticket
-- on another night's allocation, kept in step automatically.
--
-- First use: Bacheloneta's D9 night (allocation fa80ce70) → its second stop,
-- Twenties presented by Fedez (allocation b6302d87). The twin night is a
-- separate private night with no club, so live app builds show it as its own
-- ticket with Fedez's cover, and its QR can't admit anyone at the D9 door
-- (the scanner fails a scan closed when the venue doesn't match).
--
-- Past, current and future purchases: the backfill below covers tickets that
-- already exist; the trigger covers every insert/payment/refund after it.
-- Run in the SQL editor (production drifts — apply manually). Idempotent.

create table if not exists public.allocation_mirrors (
  source_allocation_id uuid primary key
    references public.promoter_allocations(id) on delete cascade,
  target_allocation_id uuid not null
    references public.promoter_allocations(id) on delete cascade
);
alter table public.allocation_mirrors enable row level security;

-- The source ticket a twin was made from. Deleting the source deletes the twin.
alter table public.promoter_guests
  add column if not exists mirror_of uuid
    references public.promoter_guests(id) on delete cascade;
create unique index if not exists promoter_guests_mirror_of_key
  on public.promoter_guests(mirror_of) where mirror_of is not null;

create or replace function public.mirror_promoter_guest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tgt uuid;
begin
  select target_allocation_id into tgt
    from allocation_mirrors where source_allocation_id = new.allocation_id;
  if tgt is null then
    return new;
  end if;

  -- A twin must never block or roll back the real ticket: any failure here
  -- (capacity, a drifted constraint) is logged and swallowed.
  begin
    if new.payment_status is null or new.payment_status in ('free', 'paid') then
      insert into promoter_guests
        (allocation_id, full_name, plus_ones, claimed_by_user, purchased_by_user,
         payment_status, amount_cents, mirror_of)
      values
        (tgt, new.full_name, coalesce(new.plus_ones, 0), new.claimed_by_user,
         new.purchased_by_user, 'free', 0, new.id)
      on conflict (mirror_of) where mirror_of is not null do update set
        full_name         = excluded.full_name,
        plus_ones         = excluded.plus_ones,
        claimed_by_user   = excluded.claimed_by_user,
        purchased_by_user = excluded.purchased_by_user;
    else
      -- pending (unpaid hold) or refunded: no twin.
      delete from promoter_guests where mirror_of = new.id;
    end if;
  exception when others then
    raise warning 'mirror_promoter_guest(%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists promoter_guests_mirror on public.promoter_guests;
create trigger promoter_guests_mirror
  after insert or update of payment_status, full_name, plus_ones, claimed_by_user, purchased_by_user
  on public.promoter_guests
  for each row execute function public.mirror_promoter_guest();

-- Bacheloneta D9 → Twenties (Fedez).
insert into public.allocation_mirrors (source_allocation_id, target_allocation_id)
select 'fa80ce70-b385-4e38-a91e-d3f356440e23', 'b6302d87-98fc-4aa6-b6e7-ad4aaef9db60'
where exists (select 1 from public.promoter_allocations where id = 'fa80ce70-b385-4e38-a91e-d3f356440e23')
  and exists (select 1 from public.promoter_allocations where id = 'b6302d87-98fc-4aa6-b6e7-ad4aaef9db60')
on conflict (source_allocation_id) do update
  set target_allocation_id = excluded.target_allocation_id;

-- Backfill: twins for every ticket already admitted on a mirrored allocation.
insert into public.promoter_guests
  (allocation_id, full_name, plus_ones, claimed_by_user, purchased_by_user,
   payment_status, amount_cents, mirror_of)
select m.target_allocation_id, g.full_name, coalesce(g.plus_ones, 0), g.claimed_by_user,
       g.purchased_by_user, 'free', 0, g.id
from public.promoter_guests g
join public.allocation_mirrors m on m.source_allocation_id = g.allocation_id
where g.payment_status is null or g.payment_status in ('free', 'paid')
on conflict (mirror_of) where mirror_of is not null do nothing;
