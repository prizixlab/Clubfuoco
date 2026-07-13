-- Promoter schedule approval: nights and series a promoter creates in the app
-- are held for Club Fuoco review before guests can join. Enforced server-side
-- by a trigger (a modified client can't bypass it), so gating never relies on
-- the app. Run in the SQL editor (production drifts — apply manually).

alter table public.promoter_nights add column if not exists review_status text not null default 'pending';
alter table public.promoter_series add column if not exists review_status text not null default 'pending';

-- Backfill: everything that already exists is live/approved. (New default is
-- 'pending' so future promoter inserts are held.)
update public.promoter_nights  set review_status = 'approved' where review_status = 'pending';
update public.promoter_series  set review_status = 'approved' where review_status = 'pending';

-- Hold new promoter submissions; exempt the service role. The service role is
-- used by (a) the portal when it approves and (b) series materialization
-- (ensureOccurrence) — those occurrences belong to an already-approved series,
-- so they publish live. Promoter (authenticated) inserts are forced held.
create or replace function public.hold_promoter_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    new.review_status := 'approved';
  else
    new.review_status := 'pending';
    if tg_table_name = 'promoter_nights' then
      new.is_published := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hold_night_submission on public.promoter_nights;
create trigger hold_night_submission before insert on public.promoter_nights
  for each row execute function public.hold_promoter_submission();

drop trigger if exists hold_series_submission on public.promoter_series;
create trigger hold_series_submission before insert on public.promoter_series
  for each row execute function public.hold_promoter_submission();
