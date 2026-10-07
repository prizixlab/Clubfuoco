-- ============================================================
-- Fix: "Database error saving new user" on sign-up
--
-- 16 public.users rows carry a customer's email while their own
-- auth.users row is an anonymous guest (no email). When that customer
-- later signs up for real (email, Apple or Google), GoTrue inserts a NEW
-- auth.users row, handle_new_user() inserts a public.users row with the
-- same email, and the UNIQUE(email) constraint aborts the whole sign-up.
--
-- This BEFORE INSERT trigger frees the email from any profile whose own
-- auth account does not own it, so handle_new_user() (AFTER INSERT, left
-- untouched because production's version drifts from the repo) succeeds.
-- Server-side only — fixes every app version and the web at once.
--
-- Run this in: Supabase Dashboard → SQL Editor. Safe to run twice.
-- ============================================================

create or replace function public.free_email_held_by_guest()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.email is not null and new.email <> '' then
    update public.users u
       set email = null
     where lower(u.email) = lower(new.email)
       and u.id <> new.id
       and not exists (
         select 1 from auth.users a
          where a.id = u.id
            and lower(a.email) = lower(u.email)
       );
  end if;
  return new;
end;
$$;

drop trigger if exists before_auth_user_created_free_email on auth.users;
create trigger before_auth_user_created_free_email
  before insert on auth.users
  for each row execute function public.free_email_held_by_guest();

-- One-time cleanup of the rows already stuck (anonymous / mismatched owners).
update public.users u
   set email = null
 where u.email is not null
   and not exists (
     select 1 from auth.users a
      where a.id = u.id
        and lower(a.email) = lower(u.email)
   );
