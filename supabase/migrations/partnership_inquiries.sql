-- Inbound inquiries from the /partners page on clubfuoco.com.
-- Public POST writes here via the service-role API; staff read via the staff
-- portal (gated by users.role). No RLS insert policy → public is blocked.
CREATE TABLE IF NOT EXISTS partnership_inquiries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company      text        NOT NULL,
  contact      text        NOT NULL,
  role         text,
  audience     text,                 -- venues | ticketing | operators
  message      text,
  triaged_at   timestamptz,
  triaged_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partnership_inquiries_created_at_idx
  ON partnership_inquiries (created_at DESC);

ALTER TABLE partnership_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read inquiries" ON partnership_inquiries;
CREATE POLICY "Staff read inquiries"
  ON partnership_inquiries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()
      AND u.role IN ('staff', 'admin')
  ));
