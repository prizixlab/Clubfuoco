-- Auto-approve toggle for the portal's Changes queue.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Submissions reach the review queue two ways, so the toggle drives one shared
-- flag (app_settings.auto_approve_submissions) read by both:
--
--   * Promoter nights & series are written client-direct from the promoter app.
--     They are already gated by the hold_promoter_submission (insert) and
--     rehold_* (edit) triggers from 20260713 / 20260714. Auto-approve is folded
--     into THOSE functions — a new branch, not a competing trigger — so there
--     are no trigger-ordering surprises and the review logic stays in one place.
--   * Supplier offer changes go through the Next server (enqueueOrApplyDirect),
--     which reads the same flag in JS and applies the change immediately.
--
-- Default FALSE. The service-role exemption is UNCHANGED (portal approvals and
-- series materialization stay auto-approved as before); only the promoter
-- branch gains the flag check.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default 'false'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('auto_approve_submissions', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "app_settings readable" on public.app_settings;
create policy "app_settings readable" on public.app_settings
  for select to anon, authenticated using (true);

-- True when the operator has turned auto-approve on. Direct jsonb comparison so
-- it can't misread — accepts a boolean `true` or a string `"true"`.
create or replace function public.auto_approve_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value in ('true'::jsonb, '"true"'::jsonb)
       from public.app_settings where key = 'auto_approve_submissions'),
    false);
$$;

-- INSERT gate (nights + series). Service role unchanged; promoter branch now
-- checks the flag.
create or replace function public.hold_promoter_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    new.review_status := 'approved';
  elsif public.auto_approve_on() then
    new.review_status := 'approved';
    if tg_table_name = 'promoter_nights' then
      new.is_published := true;
    end if;
  else
    new.review_status := 'pending';
    if tg_table_name = 'promoter_nights' then
      new.is_published := false;
    end if;
  end if;
  return new;
end;
$$;

-- EDIT gate for nights. When an edit would re-hold, auto-approve instead if on.
create or replace function public.rehold_promoter_night_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.review_status is distinct from old.review_status
     and new.review_status <> 'pending' then
    new.review_status := old.review_status;
  end if;
  if new.is_published is distinct from old.is_published and new.is_published then
    new.is_published := old.is_published;
  end if;

  if new.title            is distinct from old.title
  or new.night_date       is distinct from old.night_date
  or new.open_time        is distinct from old.open_time
  or new.close_time       is distinct from old.close_time
  or new.total_capacity   is distinct from old.total_capacity
  or new.location_name    is distinct from old.location_name
  or new.address          is distinct from old.address
  or new.lat              is distinct from old.lat
  or new.lng              is distinct from old.lng
  or new.auto_checkin     is distinct from old.auto_checkin
  or new.description      is distinct from old.description
  or new.theme            is distinct from old.theme
  or new.photo_urls       is distinct from old.photo_urls
  or new.featured         is distinct from old.featured
  or new.max_plus_ones    is distinct from old.max_plus_ones
  then
    if public.auto_approve_on() then
      new.review_status    := 'approved';
      new.rejection_reason := null;
      new.is_published     := true;
    else
      new.review_status    := 'pending';
      new.rejection_reason := null;
      new.is_published     := false;
    end if;
  end if;
  return new;
end;
$$;

-- EDIT gate for series.
create or replace function public.rehold_promoter_series_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.review_status is distinct from old.review_status
     and new.review_status <> 'pending' then
    new.review_status := old.review_status;
  end if;

  if new.title            is distinct from old.title
  or new.weekdays         is distinct from old.weekdays
  or new.open_time        is distinct from old.open_time
  or new.close_time       is distinct from old.close_time
  or new.spots            is distinct from old.spots
  or new.location_name    is distinct from old.location_name
  or new.address          is distinct from old.address
  or new.lat              is distinct from old.lat
  or new.lng              is distinct from old.lng
  or new.auto_checkin     is distinct from old.auto_checkin
  or new.description      is distinct from old.description
  or new.theme            is distinct from old.theme
  or new.photo_urls       is distinct from old.photo_urls
  or new.featured         is distinct from old.featured
  or new.max_plus_ones    is distinct from old.max_plus_ones
  then
    if public.auto_approve_on() then
      new.review_status    := 'approved';
      new.rejection_reason := null;
    else
      new.review_status    := 'pending';
      new.rejection_reason := null;
    end if;
  end if;
  return new;
end;
$$;

-- The triggers themselves are unchanged (defined in 20260713 / 20260714) and
-- keep pointing at these now-flag-aware functions. Nothing to re-create.
--
-- Clean up the earlier (wrong) standalone attempt, if it was applied:
drop trigger if exists trg_auto_approve_night  on public.promoter_nights;
drop trigger if exists trg_auto_approve_series on public.promoter_series;
drop function if exists public.auto_approve_review();
