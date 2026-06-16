-- Partner settlement export.
--
-- Run in Supabase SQL editor or via psql. The view definition is idempotent
-- (`create or replace view`), and the example queries at the bottom are how
-- ops pulls a Rumbalist payout sheet — paste into the SQL editor with the
-- date range you want, hit "Download CSV", send to Rumbalist.
--
-- Pricing rule per the attendance plan:
--   verified_attended      → full payout
--   likely_attended        → full payout (configurable)
--   partner_confirmed      → hold until we have a user/location signal too
--   user_claimed_attended  → hold for review
--   unknown                → no payout
--   no_show                → no payout
--   disputed               → manual review
--
-- Tune the per-status amounts via the CTE in the per-booking query if your
-- partner deal differs.

-- ── View: one row per attended/attendable booking ────────────────────────────

create or replace view public.booking_settlement_v as
select
  b.id                                            as booking_id,
  b.booking_date,
  b.arrival_window,
  b.party_size,
  b.booking_type,
  b.attendance_status,
  b.attendance_confidence,
  b.checked_in_at,
  b.checked_in_distance_m,
  b.partner_confirmed_at,
  b.disputed_at,
  b.total_amount                                  as booking_total,
  c.id                                            as club_id,
  c.name                                          as club_name,
  c.neighborhood                                  as club_neighborhood,
  -- Rumbalist offers, when this booking came through the Rumbalist VIP/guestlist flow
  (b.id in (
     select rp.booking_id from public.rumbalist_purchases rp where rp.booking_id is not null
   ))                                             as is_rumbalist,
  -- Crude "payable?" hint — ops still has the final call.
  case b.attendance_status
    when 'verified_attended'     then true
    when 'likely_attended'       then true
    when 'partner_confirmed'     then false
    when 'user_claimed_attended' then false
    when 'no_show'               then false
    when 'disputed'              then false
    else                              false
  end                                             as payable_hint
from public.bookings b
join public.clubs    c on c.id = b.club_id
where b.status <> 'cancelled';

comment on view public.booking_settlement_v is
  'Joined view used to generate partner payout reports. attendance_status comes
   from the booking_attendance_signals rollup; payable_hint is a suggested
   default — ops can override per partner contract.';

-- ── Query: per-partner attendance summary for a date range ──────────────────
--
-- Edit the two dates below and run. Returns one row per (club, status).

with bounds as (
  select date '2026-06-01' as from_date,
         date '2026-06-30' as to_date
)
select
  club_name,
  is_rumbalist,
  attendance_status,
  count(*)                              as booking_count,
  sum(party_size)                       as total_guests,
  count(*) filter (where payable_hint)  as payable_count,
  round(avg(attendance_confidence)::numeric, 1) as avg_confidence
from public.booking_settlement_v, bounds
where booking_date between bounds.from_date and bounds.to_date
group by club_name, is_rumbalist, attendance_status
order by club_name, is_rumbalist desc, attendance_status;

-- ── Query: per-booking payable line items for Rumbalist (CSV export) ────────
--
-- Adjust the rate-card CTE to your current commercial deal, then "Download
-- CSV" from the Supabase result panel.

with bounds as (
  select date '2026-06-01' as from_date,
         date '2026-06-30' as to_date
),
rate_card as (
  -- € paid per guest at each attendance status.
  select 'verified_attended'::text as status, 5.00::numeric as per_guest union all
  select 'likely_attended',       3.50 union all
  select 'partner_confirmed',     0.00 union all
  select 'user_claimed_attended', 0.00 union all
  select 'no_show',               0.00 union all
  select 'disputed',              0.00 union all
  select 'unknown',               0.00
)
select
  s.booking_id,
  s.club_name,
  s.booking_date,
  s.party_size,
  s.attendance_status,
  s.attendance_confidence,
  r.per_guest,
  (s.party_size * r.per_guest)        as payable_eur,
  s.disputed_at is not null           as has_dispute
from public.booking_settlement_v s
join rate_card r on r.status = s.attendance_status
, bounds
where s.is_rumbalist
  and s.booking_date between bounds.from_date and bounds.to_date
order by s.booking_date, s.club_name, s.booking_id;
