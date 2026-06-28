-- Staff referral sub-links: a main promoter creates a per-employee link to the
-- same guestlist (a one-off allocation OR a permanent series). Guests who claim
-- through that link are tagged with the referral, so the promoter can see each
-- employee's progress. The guest's claim experience is identical to a normal
-- invite — only attribution differs.

CREATE TABLE IF NOT EXISTS promoter_referrals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocation_id uuid REFERENCES promoter_allocations(id) ON DELETE CASCADE,
  series_id     uuid REFERENCES promoter_series(id) ON DELETE CASCADE,
  label         text NOT NULL,
  token         text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE promoter_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "promoter manages own referrals" ON promoter_referrals;
CREATE POLICY "promoter manages own referrals" ON promoter_referrals FOR ALL
  USING (promoter_id = auth.uid()) WITH CHECK (promoter_id = auth.uid());

ALTER TABLE promoter_guests
  ADD COLUMN IF NOT EXISTS referral_id uuid REFERENCES promoter_referrals(id) ON DELETE SET NULL;
