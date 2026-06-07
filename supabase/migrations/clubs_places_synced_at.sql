-- Tracks the last time we successfully reconciled a club's photos/reviews
-- with Google Places. Used to gate /api/places/details so we don't make a
-- Google Places call every single time a user opens a venue page — even
-- venues that already have full photo & review coverage were re-hitting
-- Google because the previous check looked at presence only.
--
-- Backfill: clubs that already have a cover_image_url AND reviews are
-- treated as "synced" so we don't smash Google when the column is added.
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS places_synced_at timestamptz;

UPDATE clubs
   SET places_synced_at = now()
 WHERE places_synced_at IS NULL
   AND cover_image_url IS NOT NULL
   AND coalesce(jsonb_array_length(coalesce(reviews, '[]'::jsonb)), 0) > 0;

CREATE INDEX IF NOT EXISTS clubs_places_synced_at_idx
  ON clubs (places_synced_at);
