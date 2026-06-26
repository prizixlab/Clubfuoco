-- Promoter applications: any user can apply; an admin reviews in Studio and
-- flips users.is_promoter (no in-app admin by design). One application per user.

CREATE TABLE IF NOT EXISTS promoter_applications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instagram   text,
  clubs       text,        -- clubs / scenes they work
  experience  text,        -- short pitch
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (user_id)
);

ALTER TABLE promoter_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own application read"   ON promoter_applications;
DROP POLICY IF EXISTS "own application insert" ON promoter_applications;
DROP POLICY IF EXISTS "own application update" ON promoter_applications;

CREATE POLICY "own application read"
  ON promoter_applications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own application insert"
  ON promoter_applications FOR INSERT WITH CHECK (user_id = auth.uid());
-- Users may edit their own application only while it's still pending. (status
-- is just a workflow label; it never grants is_promoter — that's a manual
-- Studio step — so a user relabelling their own row is harmless.)
CREATE POLICY "own application update"
  ON promoter_applications FOR UPDATE
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid());

-- ── Capacity race fix (audit #B) ────────────────────────────────────────────
-- Atomically reject a guest insert that would exceed the allocation's spots.
-- The FOR UPDATE lock on the allocation row serializes concurrent claims,
-- closing the check-then-insert TOCTOU window in the claim endpoint.
CREATE OR REPLACE FUNCTION enforce_allocation_capacity() RETURNS trigger AS $$
DECLARE
  used int;
  cap  int;
BEGIN
  SELECT spots INTO cap FROM promoter_allocations
   WHERE id = NEW.allocation_id FOR UPDATE;
  IF cap IS NULL THEN
    RETURN NEW; -- allocation gone; let FK handle it
  END IF;
  SELECT COALESCE(SUM(1 + plus_ones), 0) INTO used
    FROM promoter_guests WHERE allocation_id = NEW.allocation_id;
  IF used + 1 + NEW.plus_ones > cap THEN
    RAISE EXCEPTION 'allocation full' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_capacity ON promoter_guests;
CREATE TRIGGER trg_allocation_capacity
  BEFORE INSERT ON promoter_guests
  FOR EACH ROW EXECUTE FUNCTION enforce_allocation_capacity();
