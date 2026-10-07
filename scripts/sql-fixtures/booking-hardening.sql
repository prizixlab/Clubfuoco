-- Stand-in for the live tables 20261005_booking_hardening.sql touches.
-- Column lists from 001_initial_schema.sql and 20260820_paid_events.sql.
create extension if not exists pgcrypto;

create table public.users (id uuid primary key default gen_random_uuid(), email text);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'used')),
  stripe_payment_intent_id text
);

-- Deliberately NOT named promoter_guests_payment_status_ck: the migration must
-- find it by definition, as production's name may differ.
create table public.promoter_guests (
  id uuid primary key default gen_random_uuid(),
  payment_status text not null default 'free',
  stripe_payment_intent_id text,
  hold_expires_at timestamptz,
  constraint some_other_name check (payment_status in ('free', 'pending', 'paid', 'refunded'))
);

insert into public.promoter_guests (payment_status) values ('paid'), ('free');
insert into public.bookings (status, stripe_payment_intent_id) values ('confirmed', 'pi_a'), ('pending', null), ('pending', null);
