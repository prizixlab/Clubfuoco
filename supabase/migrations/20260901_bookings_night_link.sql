-- Link a booking back to the event it was made for.
--
-- Apply MANUALLY in the Supabase SQL editor. Every statement is idempotent.
--
-- A reservation made from the feed writes an ordinary `bookings` row, which is
-- what gives it the pass, the Tickets tab, Wallet, check-in and the survey for
-- free. But a booking only records a CLUB and a DATE, so the ticket card can
-- say "Razzmatazz, Sat 19 Sep" and nothing else — not the event's name, not who
-- is playing, not the real door times. It cannot even tell an event
-- reservation apart from someone booking that venue on the same night.
--
-- Matching on (club_id, booking_date) would paper over it, and would be wrong
-- the moment two events run at one venue on one night — which is exactly what
-- a multi-room venue like Razzmatazz does.
--
-- Nullable, because most bookings are not events and never will be.

alter table public.bookings
  add column if not exists night_id uuid references public.promoter_nights(id) on delete set null;

comment on column public.bookings.night_id is
  'The promoter_nights row this booking was reserved for, when it came from an event. Null for an ordinary venue booking.';

-- ON DELETE SET NULL, not CASCADE, and that is the whole point: deleting an
-- event must never delete somebody's ticket. The booking survives as a record
-- of a night that happened, it just stops pointing at a row that is gone.

create index if not exists bookings_night_idx
  on public.bookings(night_id) where night_id is not null;
