-- Phone-uniqueness pre-flight check used by the native signup wizard.
-- SECURITY DEFINER so callers (anon role during signup) can ask the question
-- without having SELECT rights on the phone column — only the boolean answer
-- crosses the API boundary, no phone numbers are exposed to enumeration.
create or replace function public.check_phone_exists(p_phone text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from public.users where phone = p_phone);
$$;

revoke all on function public.check_phone_exists(text) from public;
grant execute on function public.check_phone_exists(text) to anon, authenticated;

notify pgrst, 'reload schema';
