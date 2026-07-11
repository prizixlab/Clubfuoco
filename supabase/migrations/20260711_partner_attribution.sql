-- Partner attribution + transactional brand switch (Partner Portal follow-up).
-- Most supplier contracts require their brand stay visible as a subordinate
-- credit ("Guestlist by …" / "Powered by …") on the offer/booking sheet. The
-- requirement varies per supplier, so it's data-driven, not hard-coded.
-- Run in the SQL editor (production drifts from local DDL — apply manually).

alter table public.partner_brands
  add column if not exists attribution_required boolean not null default false,
  add column if not exists attribution_label text;  -- 'Guestlist by' | 'Powered by' | 'via' | …

-- Switch the active brand in one transaction so the partial-unique index
-- partner_brands_one_active can never conflict mid-switch. SECURITY DEFINER +
-- service_role-only execute: called exclusively from the portal's server
-- routes (the portal password gate + service client sit in front of it).
create or replace function public.set_active_brand(brand uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from partner_brands where id = brand) then
    raise exception 'brand % not found', brand;
  end if;
  update partner_brands set is_active = false where is_active and id <> brand;
  update partner_brands set is_active = true  where id = brand;
end;
$$;

revoke execute on function public.set_active_brand(uuid) from public, anon, authenticated;
grant  execute on function public.set_active_brand(uuid) to service_role;
