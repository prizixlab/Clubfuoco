-- Favourites for Google Places venues (replaces the old club_id-based favorites)
CREATE TABLE IF NOT EXISTS place_favorites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id    text        NOT NULL,
  name        text        NOT NULL,
  address     text,
  cover_photo text,
  rating      numeric,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, place_id)
);

ALTER TABLE place_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own place favorites" ON place_favorites;
CREATE POLICY "Users see own place favorites"
  ON place_favorites FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own place favorites" ON place_favorites;
CREATE POLICY "Users insert own place favorites"
  ON place_favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own place favorites" ON place_favorites;
CREATE POLICY "Users delete own place favorites"
  ON place_favorites FOR DELETE
  USING (auth.uid() = user_id);
