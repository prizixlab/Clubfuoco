-- Required for guest-list payout settlement: clubs pay promoters different
-- per-head rates by gender, and the platform stores the user's self-declared
-- value so the rate can be applied at signup time. "prefer_not_to_say" is a
-- valid choice — settlement defaults that bucket to the higher rate.
alter table public.users
  add column if not exists gender text;

alter table public.users
  drop constraint if exists users_gender_check;

alter table public.users
  add constraint users_gender_check
  check (gender is null or gender in ('male', 'female', 'prefer_not_to_say'));
