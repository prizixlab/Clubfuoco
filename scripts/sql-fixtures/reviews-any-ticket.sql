-- Fixture for 20261009b_reviews_any_ticket.sql (live column types).
create extension if not exists pgcrypto;
create table public.users (id uuid primary key default gen_random_uuid(), email text);
create table public.clubs (id uuid primary key default gen_random_uuid(), name text not null);
create table public.bookings (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
  club_id uuid references public.clubs(id), booking_date date, status text, survey_dismissed_at timestamptz);
create table public.external_tickets (id uuid primary key default gen_random_uuid(), user_id uuid, club_id uuid, night date);
create table public.promoter_guests (id uuid primary key default gen_random_uuid(), allocation_id uuid, claimed_by_user uuid);
create table public.booking_surveys (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating int not null, drinks text[] not null default '{}', vibe_rating int not null, crowd_rating int not null,
  would_return text not null, created_at timestamptz not null default now(), unique (booking_id));
create table public.fiamme_ledger (id uuid primary key default gen_random_uuid(), user_id uuid not null, amount int not null,
  type text not null, description text, booking_id uuid, created_at timestamptz not null default now());
create function public.award_fiamme_for_review() returns trigger language plpgsql as $$ begin return new; end; $$;
create trigger trg_award_fiamme_for_review after insert on public.booking_surveys for each row execute function public.award_fiamme_for_review();
insert into public.users (id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.clubs (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Opium');
insert into public.bookings (id, user_id, club_id, booking_date, status) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '2026-10-01', 'confirmed');
insert into public.booking_surveys (booking_id, user_id, rating, vibe_rating, crowd_rating, would_return) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 5, 5, 5, 'yes');
insert into public.external_tickets (id, user_id, club_id, night) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '2026-10-07');
