-- A promoter may not price an event they cannot actually get paid for.
--
-- Apply MANUALLY in the Supabase SQL editor. Idempotent.
--
-- WHY A TRIGGER AND NOT A CHECK IN THE APP: the promoters app inserts
-- promoter_nights STRAIGHT INTO PostgREST — there is no server route between it
-- and the table. Every rule about pricing therefore lives in Swift, which is not
-- a boundary: a modified client, a replayed request, or simply an account Stripe
-- disables AFTER the night was priced all produce an event with a price nobody
-- can pay. The database is the only place this can actually be enforced.
--
-- TWO CONDITIONS, and they are different things:
--
--   charges_enabled  — Stripe has cleared this promoter to RECEIVE money.
--                      Without it the guest's checkout fails at the card form.
--
--   card_verified    — we hold a working card for the promoter. This is about
--                      money going the OTHER way. Refunds, chargebacks and our
--                      unpaid fees all need somewhere to land, and a promoter
--                      who has been paid out and then disputes-away a night
--                      leaves a hole. The same card-on-file mechanism already
--                      gates featured promotion; this reuses it rather than
--                      inventing a second one.

create or replace function public.promoter_can_sell(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select pa.charges_enabled from public.promoter_payout_accounts pa
      where pa.user_id = p_user), false)
   and coalesce(
    (select ba.card_verified from public.promoter_billing_accounts ba
      where ba.user_id = p_user), false);
$$;

revoke all on function public.promoter_can_sell(uuid) from public;
grant execute on function public.promoter_can_sell(uuid) to authenticated;

-- Who owns this night. created_by is set by default to auth.uid() on insert,
-- but a night MATERIALIZED FROM A SERIES is written by the service role and has
-- created_by = null — so fall back to the series' promoter, or this rejects
-- every recurring paid night.
create or replace function public.night_owner(n public.promoter_nights)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    n.created_by,
    (select s.promoter_id from public.promoter_series s where s.id = n.series_id),
    (select a.promoter_id from public.promoter_allocations a where a.night_id = n.id limit 1)
  );
$$;

create or replace function public.enforce_price_requires_payouts()
returns trigger
language plpgsql
as $$
declare
  owner uuid;
begin
  -- Free nights are untouched, which is every night that exists today.
  if coalesce(new.price_cents, 0) = 0 then
    return new;
  end if;

  -- Re-saving an already-priced night at the SAME price is allowed even if the
  -- promoter's status has since lapsed. Otherwise a promoter whose card expired
  -- could not edit the start time of a night that is already selling, and would
  -- have no way to fix anything about it.
  if tg_op = 'UPDATE' and coalesce(old.price_cents, 0) = coalesce(new.price_cents, 0) then
    return new;
  end if;

  owner := public.night_owner(new);

  if owner is null or not public.promoter_can_sell(owner) then
    raise exception
      'Set up payouts and add a card before charging for entry.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists promoter_nights_price_guard on public.promoter_nights;
create trigger promoter_nights_price_guard
  before insert or update of price_cents on public.promoter_nights
  for each row execute function public.enforce_price_requires_payouts();

-- Same rule for a series, whose price is copied onto every night it spawns.
create or replace function public.enforce_series_price_requires_payouts()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.price_cents, 0) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.price_cents, 0) = coalesce(new.price_cents, 0) then
    return new;
  end if;
  if not public.promoter_can_sell(new.promoter_id) then
    raise exception
      'Set up payouts and add a card before charging for entry.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists promoter_series_price_guard on public.promoter_series;
create trigger promoter_series_price_guard
  before insert or update of price_cents on public.promoter_series
  for each row execute function public.enforce_series_price_requires_payouts();
