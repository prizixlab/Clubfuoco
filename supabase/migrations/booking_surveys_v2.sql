-- v2: per-drink star ratings, music genres, per-category custom drinks
-- Enables: "best club for a Negroni" + "what does this user actually like to drink"

ALTER TABLE booking_surveys
  ADD COLUMN IF NOT EXISTS drink_ratings jsonb NOT NULL DEFAULT '{}',
  -- e.g. { "Negroni": 4, "Estrella Damm": 5 }

  ADD COLUMN IF NOT EXISTS music_genres  text[] NOT NULL DEFAULT '{}',
  -- e.g. ["House", "Techno"]

  ADD COLUMN IF NOT EXISTS drink_custom  jsonb NOT NULL DEFAULT '{}';
  -- e.g. { "cocktails": "their house signature" }

-- GIN indexes for jsonb/array analytics queries
CREATE INDEX IF NOT EXISTS idx_surveys_drink_ratings ON booking_surveys USING gin(drink_ratings);
CREATE INDEX IF NOT EXISTS idx_surveys_music_genres  ON booking_surveys USING gin(music_genres);

-- Example query — avg Negroni rating per club:
-- SELECT b.club_id, avg((s.drink_ratings->>'Negroni')::numeric) AS avg_negroni
-- FROM booking_surveys s
-- JOIN bookings b ON b.id = s.booking_id
-- WHERE s.drink_ratings ? 'Negroni'
-- GROUP BY b.club_id
-- ORDER BY avg_negroni DESC;
