-- Custom event locations (non-partner venues / parties) + per-event auto
-- check-in. club_id becomes optional; nights/series may instead carry a
-- custom pin (lat/lng) + name + address. auto_checkin gates the consumer
-- app's geofence (on by default).

ALTER TABLE promoter_nights
  ALTER COLUMN club_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS auto_checkin boolean NOT NULL DEFAULT true;

ALTER TABLE promoter_series
  ALTER COLUMN club_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS auto_checkin boolean NOT NULL DEFAULT true;
