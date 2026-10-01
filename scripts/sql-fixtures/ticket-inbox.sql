-- Fixture for 20261001_ticket_inbox.sql: the Supabase pieces a plain Postgres
-- lacks (auth.uid(), the anon/authenticated roles) and the one table it
-- references. users.id is uuid in production (checked live, 1 Oct 2026).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.users (id uuid primary key default gen_random_uuid(), email text, phone text);
