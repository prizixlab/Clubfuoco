-- Two take rates per promoter, not one.
--
-- Apply MANUALLY in the Supabase SQL editor. Idempotent.
--
-- A public offer and a private event are different deals and get priced
-- differently. A public offer is listed in the app, so we are supplying the
-- audience and the discovery; a private event is the promoter's own crowd
-- arriving through their own link, and we are supplying the rails. Charging
-- one number for both means one of them is always wrong.
--
-- platform_fee_bps keeps its name and its meaning — the PRIVATE-event rate,
-- which is what every existing row already represents and what the checkout
-- route has been reading. Renaming it would have meant rewriting live data and
-- every reference for cosmetic tidiness.

alter table public.promoter_payout_accounts
  add column if not exists platform_fee_public_bps integer not null default 1200,
  add column if not exists fee_note_public text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'promoter_payout_accounts_fee_public_ck'
  ) then
    alter table public.promoter_payout_accounts
      add constraint promoter_payout_accounts_fee_public_ck
      check (platform_fee_public_bps >= 0 and platform_fee_public_bps <= 10000);
  end if;
end $$;

comment on column public.promoter_payout_accounts.platform_fee_bps is
  'Basis points we take from a PRIVATE event''s ticket sales. 1200 = 12%.';
comment on column public.promoter_payout_accounts.platform_fee_public_bps is
  'Basis points we take from a PUBLIC offer''s ticket sales. 1200 = 12%.';
