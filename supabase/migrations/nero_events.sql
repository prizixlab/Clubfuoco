-- Partner clubs can host Nero-exclusive events

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS is_partner boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_clubs_partner ON clubs(is_partner) WHERE is_partner = true;

-- Nero-exclusive events posted by partner clubs
CREATE TABLE IF NOT EXISTS nero_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  location     text,          -- can differ from club address (villa, consulate, etc.)
  event_date   timestamptz NOT NULL,
  capacity     int NOT NULL DEFAULT 40,
  tier_req     text NOT NULL DEFAULT 'black' CHECK (tier_req IN ('black')),
  plus_one     boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nero_events_date
  ON nero_events(event_date ASC) WHERE is_published = true;

-- One Nero event per club per calendar year (hard constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nero_events_club_year
  ON nero_events (club_id, date_trunc('year', event_date))
  WHERE is_published = true;

ALTER TABLE nero_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nero members read events"
  ON nero_events FOR SELECT
  USING (
    is_published = true
    AND event_date > now()
    AND EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND membership_tier = 'black'
    )
  );

CREATE POLICY "club owners manage nero events"
  ON nero_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clubs
      WHERE id = nero_events.club_id AND owner_user_id = auth.uid()
    )
  );

-- RSVPs
CREATE TABLE IF NOT EXISTS nero_event_rsvps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES nero_events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'going'
             CHECK (status IN ('going', 'interested', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

ALTER TABLE nero_event_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own rsvps"
  ON nero_event_rsvps FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
