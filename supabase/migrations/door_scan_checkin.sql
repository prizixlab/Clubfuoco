-- Door scans feed the promoter app's check-in state.
-- Distinguishes HOW a guest was checked in so the promoter app can show
-- "SCANNED IN" (door scanner) vs "ARRIVED" (geofence / manual).
-- Apply MANUALLY in the Supabase SQL editor.

alter table public.promoter_guests
  add column if not exists checked_in_source text;   -- 'door_scan' | 'geofence' | 'promoter'
