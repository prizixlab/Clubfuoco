-- Adds the `morning_after_opened` attendance signal: tapping the next-morning
-- "did you get in?" push is a soft "probably arrived" signal (→ likely_attended,
-- weakest positive — overridden by any stronger signal). Run in the SQL editor.

-- 1. Allow the new signal kind.
alter table public.booking_attendance_signals
  drop constraint if exists booking_attendance_signals_kind_check;
alter table public.booking_attendance_signals
  add constraint booking_attendance_signals_kind_check
  check (kind in (
    'user_checkin',
    'geo_presence',
    'pass_viewed',
    'post_entry_got_in',
    'post_entry_issue',
    'morning_after_opened',
    'partner_added_to_list',
    'partner_attended',
    'partner_no_show',
    'partner_rejected'
  ));

-- 2. Fold it into the rollup — weakest positive, so anything real wins.
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
  v_has_morning          bool;
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
    bool_or(kind = 'post_entry_issue' and metadata->>'reason' = 'did_not_go'),
    bool_or(kind = 'morning_after_opened')
  into
    v_has_user_checkin, v_has_geo, v_has_pass_viewed,
    v_has_got_in, v_has_issue,
    v_has_partner_attended, v_has_partner_no_show, v_has_partner_rejected,
    v_did_not_go, v_has_morning
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
  elsif v_has_morning then
    -- Only the morning-after tap and nothing else: probably arrived.
    v_status := 'likely_attended';
    v_score  := 40;
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
