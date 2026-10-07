-- Platform-settled promoters: sales land on Club Fuoco's own Stripe account.
--
-- NOT APPLIED — run in the SQL editor.
--
-- For a promoter who is selling before they have finished Connect onboarding.
-- Their guests pay Club Fuoco directly (a plain charge: no transfer, no
-- application fee, no on_behalf_of) and Club Fuoco settles with them by hand.
-- See isPlatformSettled in src/lib/connect.ts, which reads
-- this same table, so the checkout and the price guard cannot disagree.
--
-- A named list, deliberately. It is NOT a fallback for "this promoter can't be
-- paid": that would silently make us merchant of record for every promoter
-- whose Connect account Stripe disables. Delete a row once that promoter's own
-- account is live.

create table if not exists public.platform_settled_promoters (
  user_id    uuid primary key references public.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- Service role only. No policies: nothing on the client reads or writes this.
alter table public.platform_settled_promoters enable row level security;

insert into public.platform_settled_promoters (user_id, note)
values ('ade922f2-f3a0-4e2b-9009-6151d5282bb3',
        'Bacheloneta — SIROKO student night 9 Oct 2026, before Connect onboarding')
on conflict (user_id) do nothing;

-- Same body as 20260821_price_requires_payouts.sql, plus the platform-settled
-- exemption. This is what the price guard triggers on promoter_nights and
-- promoter_series call, so a priced night (and the release trigger that keeps
-- price_cents in step) is accepted for these promoters.
create or replace function public.promoter_can_sell(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_settled_promoters ps where ps.user_id = p_user)
    or (
      coalesce(
        (select pa.charges_enabled from public.promoter_payout_accounts pa
          where pa.user_id = p_user), false)
      and coalesce(
        (select ba.card_verified from public.promoter_billing_accounts ba
          where ba.user_id = p_user), false)
    );
$$;

-- Supabase-only roles; guarded so the file still runs on a plain Postgres.
do $$
begin
  revoke all on function public.promoter_can_sell(uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.promoter_can_sell(uuid) to authenticated;
  end if;
end $$;

-- After applying, the night can be priced (run from the API or here):
--   update public.promoter_nights set price_cents = 500
--    where id = 'b3fc9450-9a01-4438-8ba8-b6dfa9a64f1b';
