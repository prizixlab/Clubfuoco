-- Promoter brand profile (shown on invite pages + front-page promotion).
CREATE TABLE IF NOT EXISTS promoter_profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  brand_name text,
  logo_url   text,
  bio        text,
  instagram  text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE promoter_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own profile read"  ON promoter_profiles;
DROP POLICY IF EXISTS "own profile write" ON promoter_profiles;
CREATE POLICY "own profile read"  ON promoter_profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own profile write" ON promoter_profiles FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
