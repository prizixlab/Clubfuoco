-- A standard way for any partner brand to sell through Fourvenues, the way
-- HypeList does: Fourvenues gives the brand a referral channel
-- (https://site.fourvenues.com/en/iframe/<channel>/events) and the portal
-- stores it here. agentbox reads every channel set here hourly
-- (fourvenues_all.py), merges them into the one catalog the app pulls, and
-- files each night under that brand's promoter account.
--
-- One channel belongs to one brand. Until this runs, agentbox and the app fall
-- back to HypeList's channel only.

alter table public.partner_brands
  add column if not exists fourvenues_channel text;

create unique index if not exists partner_brands_fourvenues_channel_uniq
  on public.partner_brands (fourvenues_channel)
  where fourvenues_channel is not null;

update public.partner_brands
   set fourvenues_channel = 'clubfuoco-hype'
 where key = 'hypelist' and fourvenues_channel is null;
