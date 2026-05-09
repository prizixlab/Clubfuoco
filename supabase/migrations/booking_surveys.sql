-- Post-visit surveys: shown the day after a confirmed booking
CREATE TABLE IF NOT EXISTS booking_surveys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  -- Q1: overall rating
  rating        int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  -- Q2: what they drank (multi-select array)
  drinks        text[] NOT NULL DEFAULT '{}',
  -- Q3: music / vibe
  vibe_rating   int  NOT NULL CHECK (vibe_rating BETWEEN 1 AND 5),
  -- Q4: crowd
  crowd_rating  int  NOT NULL CHECK (crowd_rating BETWEEN 1 AND 5),
  -- Q5: would return
  would_return  text NOT NULL CHECK (would_return IN ('yes', 'maybe', 'no')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);

ALTER TABLE booking_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can insert own surveys"
  ON booking_surveys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can read own surveys"
  ON booking_surveys FOR SELECT
  USING (auth.uid() = user_id);
