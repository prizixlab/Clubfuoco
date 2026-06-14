-- ============================================================
-- Anonymous sign-in support
--
-- "Continue as guest" (supabase.auth.signInAnonymously) inserts an
-- auth.users row with email = NULL. public.users.email was NOT NULL,
-- so handle_new_user() failed and GoTrue returned
-- 500 "Database error creating anonymous user" — every guest browsed
-- without a session, so no stable user.id for MAU, favourites,
-- signals or presence.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1) Allow NULL email for anonymous users. UNIQUE is kept: Postgres
--    treats NULLs as distinct, so any number of guest rows coexist.
alter table public.users alter column email drop not null;

-- 2) When a guest upgrades to a full account, GoTrue UPDATEs the existing
--    auth.users row (no insert, so handle_new_user never fires). Mirror
--    the confirmed address into public.users. Also covers email changes
--    from the settings screen, which previously left public.users stale.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.users
     set email = new.email
   where id = new.id
     and email is distinct from new.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();
