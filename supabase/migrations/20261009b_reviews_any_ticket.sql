-- 20261009b_reviews_any_ticket.sql
--
-- The morning-after review used to exist only for `bookings`. Guests who got
-- in through a Fourvenues link (external_tickets: free lists, tickets, tables)
-- or a promoter's invite guestlist (promoter_guests) were never asked.
--
-- A review can now be about any of the three. Exactly one source is set;
-- club_id + night are stored on the review itself so everything downstream
-- (Fiamme points, DJ scores, taste profile) no longer needs a booking row.
--
-- Additive and idempotent: safe to paste twice.

alter table public.booking_surveys alter column booking_id drop not null;

alter table public.booking_surveys
  add column if not exists external_ticket_id uuid references public.external_tickets(id) on delete cascade;
alter table public.booking_surveys
  add column if not exists promoter_guest_id uuid references public.promoter_guests(id) on delete cascade;
alter table public.booking_surveys
  add column if not exists club_id uuid references public.clubs(id) on delete set null;
alter table public.booking_surveys
  add column if not exists night date;

-- One review per ticket / guest spot, like UNIQUE(booking_id).
create unique index if not exists booking_surveys_external_ticket_key
  on public.booking_surveys (external_ticket_id) where external_ticket_id is not null;
create unique index if not exists booking_surveys_promoter_guest_key
  on public.booking_surveys (promoter_guest_id) where promoter_guest_id is not null;

do $$ begin
  alter table public.booking_surveys
    add constraint booking_surveys_one_source
    check (num_nonnulls(booking_id, external_ticket_id, promoter_guest_id) = 1);
exception when duplicate_object then null; end $$;

-- Existing reviews carry their booking's club and night too.
update public.booking_surveys bs
   set club_id = b.club_id, night = b.booking_date
  from public.bookings b
 where b.id = bs.booking_id and (bs.club_id is null or bs.night is null);

-- "Don't ask me again", like bookings.survey_dismissed_at.
alter table public.external_tickets add column if not exists survey_dismissed_at timestamptz;
alter table public.promoter_guests  add column if not exists survey_dismissed_at timestamptz;

-- Fiamme points: the club comes from the review itself when there's no booking.
create or replace function public.award_fiamme_for_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id     uuid;
  v_prior_count int;
begin
  -- +10 base
  insert into public.fiamme_ledger (user_id, amount, type, description, booking_id)
  values (new.user_id, 10, 'review', 'Verified review', new.booking_id);

  -- +50 first review of this club by anyone
  v_club_id := coalesce(new.club_id, (select club_id from public.bookings where id = new.booking_id));
  if v_club_id is not null then
    select count(*) into v_prior_count
    from public.booking_surveys bs
    left join public.bookings b on b.id = bs.booking_id
    where coalesce(bs.club_id, b.club_id) = v_club_id and bs.id <> new.id;

    if v_prior_count = 0 then
      insert into public.fiamme_ledger (user_id, amount, type, description, booking_id)
      values (new.user_id, 50, 'first_review', 'First review at this venue', new.booking_id);
    end if;
  end if;

  return new;
end;
$$;
