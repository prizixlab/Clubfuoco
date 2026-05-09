-- Guest Lists
CREATE TABLE IF NOT EXISTS guest_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  event_name      TEXT NOT NULL,
  event_date      DATE NOT NULL,
  cutoff_time     TIME NOT NULL DEFAULT '01:00',
  capacity        INT NOT NULL DEFAULT 50,
  signups_count   INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  free_entry_label TEXT NOT NULL DEFAULT 'Free Entry Tonight',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Guest List Signups
CREATE TABLE IF NOT EXISTS guest_list_signups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id   UUID NOT NULL REFERENCES guest_lists(id) ON DELETE CASCADE,
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  party_size      INT NOT NULL DEFAULT 1,
  email           TEXT,
  phone           TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-increment signups_count
CREATE OR REPLACE FUNCTION increment_signup_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE guest_lists SET signups_count = signups_count + NEW.party_size WHERE id = NEW.guest_list_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_signup
  AFTER INSERT ON guest_list_signups
  FOR EACH ROW EXECUTE FUNCTION increment_signup_count();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guest_lists_club_date ON guest_lists(club_id, event_date);
CREATE INDEX IF NOT EXISTS idx_guest_lists_active ON guest_lists(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_signups_guest_list ON guest_list_signups(guest_list_id);

-- RLS
ALTER TABLE guest_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_list_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active guest lists"
  ON guest_lists FOR SELECT USING (is_active = true);

CREATE POLICY "Users can create own signups"
  ON guest_list_signups FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own signups"
  ON guest_list_signups FOR SELECT USING (true);
