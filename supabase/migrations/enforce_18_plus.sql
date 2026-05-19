-- Club Fuoco is strictly 18+. This trigger rejects any users row whose
-- birthday makes the person under 18 — a hard server-side guard so a
-- bypassed or modified client can never create an underage account.
--
-- Run this in the Supabase SQL editor.

create or replace function enforce_adult_birthday()
returns trigger as $$
begin
  if new.birthday is not null
     and new.birthday > (current_date - interval '18 years') then
    raise exception 'You must be 18 or older to use Club Fuoco.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_adult_check on users;
create trigger users_adult_check
  before insert or update on users
  for each row execute function enforce_adult_birthday();
