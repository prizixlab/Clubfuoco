-- Promoter box-detail features. Run in the SQL editor (production drifts —
-- apply manually).
--
-- 1. skipped_dates on promoter_series: lets a promoter take a specific week
--    off a recurring guestlist. resolveOccurrenceDate() skips these dates, so
--    the permanent link (and the app's "this week" view) jump to the next
--    non-skipped occurrence. Deliberately NOT in the rehold_series_edit
--    trigger's content-change list — skipping a week is scheduling, not a
--    content edit, and must not re-enter review.
--
-- 2. location_consent on promoter_guests: whether the guest agreed to share
--    location for geofence auto check-in. Set at claim time when the invite
--    page/consumer app passes it, and stamped true by the auto check-in
--    endpoint (a geofence check-in is itself proof of consent). Surfaced to
--    the promoter in the app's guest detail sheet.

alter table public.promoter_series
  add column if not exists skipped_dates date[] not null default '{}';

alter table public.promoter_guests
  add column if not exists location_consent boolean;
