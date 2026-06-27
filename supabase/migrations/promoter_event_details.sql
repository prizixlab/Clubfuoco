-- Event description, theme (+ optional translation flag), and event photos.
-- Photos live in a public Storage bucket; we store their public URLs.

ALTER TABLE promoter_nights
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS theme text,
  ADD COLUMN IF NOT EXISTS theme_translate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';

ALTER TABLE promoter_series
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS theme text,
  ADD COLUMN IF NOT EXISTS theme_translate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public)
  VALUES ('event-photos', 'event-photos', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "promoters upload event photos" ON storage.objects;
CREATE POLICY "promoters upload event photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-photos');
