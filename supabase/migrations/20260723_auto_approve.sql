-- Auto-approve toggle for the portal's Changes queue.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Submissions reach the review queue two ways, so auto-approve has to cover
-- both from ONE shared flag (app_settings.auto_approve_submissions):
--
--   * Promoter nights & series are written client-direct from the promoter
--     app (Supabase + RLS), never through a Next route — so a DB trigger flips
--     pending → approved for them.
--   * Supplier offer changes go through the Next server (enqueueOrApplyDirect),
--     which reads the same flag and applies the change immediately instead of
--     queuing.
--
-- Default is FALSE (manual approval) — the safe default, and what deploying
-- this before anyone touches the toggle preserves.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default 'false'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('auto_approve_submissions', 'false'::jsonb)
on conflict (key) do nothing;

-- Read-only to clients; only the portal (service role) writes it.
alter table public.app_settings enable row level security;
drop policy if exists "app_settings readable" on public.app_settings;
create policy "app_settings readable" on public.app_settings
  for select to anon, authenticated using (true);

-- When auto-approve is on, a row landing in 'pending' is flipped to approved
-- as it's written, so the guest-join guard never blocks it.
create or replace function public.auto_approve_review()
returns trigger
language plpgsql
as $$
begin
  if coalesce(
       (select (value #>> '{}')::boolean
          from public.app_settings
         where key = 'auto_approve_submissions'),
       false)
  then
    new.review_status := 'approved';
    new.rejection_reason := null;
    if tg_table_name = 'promoter_nights' then
      new.is_published := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_approve_night on public.promoter_nights;
create trigger trg_auto_approve_night
  before insert or update on public.promoter_nights
  for each row
  when (new.review_status = 'pending')
  execute function public.auto_approve_review();

drop trigger if exists trg_auto_approve_series on public.promoter_series;
create trigger trg_auto_approve_series
  before insert or update on public.promoter_series
  for each row
  when (new.review_status = 'pending')
  execute function public.auto_approve_review();

-- Verify:
--   update public.app_settings set value='true' where key='auto_approve_submissions';
--   -- insert a pending night; it should read back as approved+published.
--   update public.app_settings set value='false' where key='auto_approve_submissions';
