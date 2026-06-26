-- Promoter "series": recurring guestlist with ONE permanent invite token.
-- Concrete nights/allocations are materialized lazily by the API the first
-- time a link is opened for a given week. See src/lib/promoter-series.ts.

CREATE TABLE IF NOT EXISTS promoter_series (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title            text,
  weekdays         int[] NOT NULL,          -- 1=Sun … 7=Sat (Swift Calendar.weekday)
  open_time        time,
  close_time       time,
  spots            int NOT NULL DEFAULT 25,
  payout_per_guest numeric(10,2) NOT NULL DEFAULT 0,
  group_visible    boolean NOT NULL DEFAULT true,
  invite_token     text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE promoter_nights
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES promoter_series(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS promoter_nights_series_date
  ON promoter_nights(series_id, night_date) WHERE series_id IS NOT NULL;

ALTER TABLE promoter_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter manages own series" ON promoter_series;
CREATE POLICY "promoter manages own series"
  ON promoter_series FOR ALL
  USING (promoter_id = auth.uid())
  WITH CHECK (promoter_id = auth.uid());

-- Dedupe one claim per logged-in user per allocation (audit finding #3).
CREATE UNIQUE INDEX IF NOT EXISTS promoter_guests_one_claim_per_user
  ON promoter_guests (allocation_id, claimed_by_user)
  WHERE claimed_by_user IS NOT NULL;
