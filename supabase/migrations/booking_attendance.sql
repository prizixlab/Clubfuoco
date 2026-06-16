-- Booking attendance verification — confidence-based.
--
-- We don't get door scans in early stage, so a booking's attendance is inferred
-- from several weak signals:
--
--   user_checkin        : the user tapped "I'm here" near the venue, inside
--                         the arrival window. Strongest user signal.
--   geo_presence        : passive app-open inside the venue radius during the
--                         window. Supporting signal.
--   pass_viewed         : booking/pass screen opened near the venue and inside
--                         the window. Supporting signal.
--   post_entry_got_in   : user self-reports they got in.
--   post_entry_issue    : user self-reports a problem at the door.
--   partner_added_to_list / partner_attended / partner_no_show /
--   partner_rejected    : Rumbalist/promoter reports (loaded by SQL today).
--
-- A trigger rolls all signals for a booking up into a single attendance_status
-- + confidence score on bookings — the partner-settlement view reads those.
--
-- Run in Supabase SQL editor.

-- ── Signal log ────────────────────────────────────────────────────────────────

create table if not exists public.booking_attendance_signals (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  user_id     uuid          references public.users(id),
  club_id     uuid not null references public.clubs(id),
  kind        text not null check (kind in (
                'user_checkin',
                'geo_presence',
                'pass_viewed',
                'post_entry_got_in',
                'post_entry_issue',
                'partner_added_to_list',
                'partner_attended',
                'partner_no_show',
                'partner_rejected'
              )),
  source      text not null default 'ios' check (source in ('ios','web','partner','admin')),
  lat         decimal(10, 8),
  lng         decimal(11, 8),
  distance_m  integer,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists booking_attendance_signals_booking_idx
  on public.booking_attendance_signals (booking_id, created_at desc);
create index if not exists booking_attendance_signals_user_idx
  on public.booking_attendance_signals (user_id, created_at desc);
create index if not exists booking_attendance_signals_club_kind_idx
  on public.booking_attendance_signals (club_id, kind, created_at desc);

alter table public.booking_attendance_signals enable row level security;

-- All access via API routes using the service role; the client never reads
-- this table directly, so no SELECT policy is needed.

-- ── Bookings: rolled-up attendance status ────────────────────────────────────

alter table public.bookings
  add column if not exists attendance_status      text
    not null default 'unknown'
    check (attendance_status in (
      'unknown',
      'user_claimed_attended',
      'likely_attended',
      'partner_confirmed',
      'verified_attended',
      'no_show',
      'disputed'
    )),
  add column if not exists attendance_confidence  smallint not null default 0
    check (attendance_confidence between 0 and 100),
  add column if not exists checked_in_distance_m  integer,
  add column if not exists partner_confirmed_at   timestamptz,
  add column if not exists disputed_at            timestamptz;

create index if not exists idx_bookings_attendance
  on public.bookings (attendance_status, booking_date);

-- ── Rule engine ──────────────────────────────────────────────────────────────
--
-- Higher score wins. The order encodes the priority: a partner_rejected/issue
-- moves the booking to disputed regardless of other signals; a user_checkin
-- + partner_attended pair is the strongest positive evidence.

create or replace function public.compute_booking_attendance(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_user_checkin     bool;
  v_has_geo              bool;
  v_has_pass_viewed      bool;
  v_has_got_in           bool;
  v_has_issue            bool;
  v_has_partner_attended bool;
  v_has_partner_no_show  bool;
  v_has_partner_rejected bool;
  v_did_not_go           bool;
  v_status   text;
  v_score    smallint;
  v_checkin  timestamptz;
  v_distance integer;
  v_partner  timestamptz;
  v_dispute  timestamptz;
begin
  select
    bool_or(kind = 'user_checkin'),
    bool_or(kind = 'geo_presence'),
    bool_or(kind = 'pass_viewed'),
    bool_or(kind = 'post_entry_got_in'),
    bool_or(kind = 'post_entry_issue'),
    bool_or(kind = 'partner_attended'),
    bool_or(kind = 'partner_no_show'),
    bool_or(kind = 'partner_rejected'),
    bool_or(kind = 'post_entry_issue' and metadata->>'reason' = 'did_not_go')
  into
    v_has_user_checkin, v_has_geo, v_has_pass_viewed,
    v_has_got_in, v_has_issue,
    v_has_partner_attended, v_has_partner_no_show, v_has_partner_rejected,
    v_did_not_go
  from public.booking_attendance_signals
  where booking_id = p_booking_id;

  select created_at, distance_m
    into v_checkin, v_distance
    from public.booking_attendance_signals
   where booking_id = p_booking_id and kind = 'user_checkin'
   order by created_at asc limit 1;

  select min(created_at) into v_partner
    from public.booking_attendance_signals
   where booking_id = p_booking_id
     and kind in ('partner_attended','partner_no_show','partner_rejected','partner_added_to_list');

  select min(created_at) into v_dispute
    from public.booking_attendance_signals
   where booking_id = p_booking_id
     and kind in ('post_entry_issue','partner_rejected');

  -- Priority order — first match wins.
  if v_has_partner_rejected or v_has_issue then
    v_status := 'disputed';
    v_score  := 30;
  elsif v_did_not_go then
    v_status := 'no_show';
    v_score  := 95;
  elsif v_has_user_checkin and v_has_partner_attended then
    v_status := 'verified_attended';
    v_score  := 100;
  elsif v_has_user_checkin then
    v_status := 'likely_attended';
    v_score  := 80;
  elsif v_has_geo and v_has_pass_viewed then
    v_status := 'likely_attended';
    v_score  := 65;
  elsif v_has_partner_attended then
    v_status := 'partner_confirmed';
    v_score  := 60;
  elsif v_has_got_in then
    v_status := 'user_claimed_attended';
    v_score  := 50;
  elsif v_has_partner_no_show then
    v_status := 'no_show';
    v_score  := 75;
  else
    v_status := 'unknown';
    v_score  := 0;
  end if;

  update public.bookings
     set attendance_status     = v_status,
         attendance_confidence = v_score,
         checked_in_at         = coalesce(v_checkin, checked_in_at),
         checked_in_distance_m = coalesce(v_distance, checked_in_distance_m),
         partner_confirmed_at  = coalesce(v_partner, partner_confirmed_at),
         disputed_at           = coalesce(v_dispute, disputed_at)
   where id = p_booking_id;
end;
$$;

create or replace function public.trg_compute_booking_attendance()
returns trigger
language plpgsql
as $$
begin
  perform public.compute_booking_attendance(new.booking_id);
  return new;
end;
$$;

drop trigger if exists booking_attendance_signals_recompute
  on public.booking_attendance_signals;
create trigger booking_attendance_signals_recompute
  after insert on public.booking_attendance_signals
  for each row execute function public.trg_compute_booking_attendance();
