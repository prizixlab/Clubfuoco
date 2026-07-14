-- Promoter review, phase 2: rejection reasons threaded back to the promoter,
-- server-enforced re-review on edits, and device tokens for review-outcome
-- pushes. Run in the SQL editor (production drifts — apply manually).

-- ── Rejection reason ────────────────────────────────────────────────────────
-- Stored by the portal on reject; shown to the promoter in the app.
-- (pending_changes already carries a `note` column for offer rejections.)

alter table public.promoter_nights  add column if not exists rejection_reason text;
alter table public.promoter_series  add column if not exists rejection_reason text;

-- ── Edits re-enter review ───────────────────────────────────────────────────
-- The insert trigger (hold_promoter_submission) only covers creation. These
-- update triggers make edits re-enter review server-side, so a modified client
-- can't push content changes live. Service role (portal approve, series
-- materialization) is exempt. Non-content toggles the app legitimately flips
-- (group_visible, is_active, payout_status) do NOT re-hold.

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

  -- Clients may only move review_status to 'pending' (resubmit) — never
  -- approve/reject themselves.
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
    new.review_status    := 'pending';
    new.rejection_reason := null;
    new.is_published     := false;
  end if;
  return new;
end;
$$;

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
    new.review_status    := 'pending';
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists rehold_night_edit on public.promoter_nights;
create trigger rehold_night_edit before update on public.promoter_nights
  for each row execute function public.rehold_promoter_night_edit();

drop trigger if exists rehold_series_edit on public.promoter_series;
create trigger rehold_series_edit before update on public.promoter_series
  for each row execute function public.rehold_promoter_series_edit();

-- ── Device tokens (push foundation) ─────────────────────────────────────────
-- APNs tokens per user; the promoter app upserts its own token directly
-- (RLS-scoped), the server reads them with the service role when sending
-- review-outcome pushes.

create table if not exists public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token       text not null unique,
  platform    text not null default 'ios',
  app         text not null default 'promoters',
  environment text not null default 'production',   -- 'production' | 'sandbox'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

drop policy if exists "own device tokens" on public.device_tokens;
create policy "own device tokens"
  on public.device_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
