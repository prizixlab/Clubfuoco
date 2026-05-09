-- ============================================================
-- Account types, DJ profiles, club staff, enhanced guest lists
-- ============================================================

-- Add account_type to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'user'
  CHECK (account_type IN ('user', 'club', 'dj'));

-- DJ Profiles
CREATE TABLE IF NOT EXISTS dj_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  stage_name      TEXT NOT NULL,
  bio             TEXT,
  avatar_url      TEXT,
  genres          TEXT[] DEFAULT '{}',
  soundcloud_url  TEXT,
  mixcloud_url    TEXT,
  spotify_url     TEXT,
  instagram_handle TEXT,
  is_verified     BOOLEAN NOT NULL DEFAULT false,
  follower_count  INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- DJ Gigs (DJ linked to a club night)
CREATE TABLE IF NOT EXISTS dj_gigs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dj_id           UUID NOT NULL REFERENCES dj_profiles(id) ON DELETE CASCADE,
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  guest_list_id   UUID REFERENCES guest_lists(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL,
  gig_date        DATE NOT NULL,
  start_time      TIME,
  end_time        TIME,
  set_type        TEXT DEFAULT 'headline' CHECK (set_type IN ('headline', 'support', 'b2b', 'resident')),
  is_confirmed    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Club Staff (which users manage which clubs)
CREATE TABLE IF NOT EXISTS club_staff (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager', 'promoter')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, club_id)
);

-- DJ followers
CREATE TABLE IF NOT EXISTS dj_follows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dj_id           UUID NOT NULL REFERENCES dj_profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, dj_id)
);

-- Enhance guest lists with DJ link + tiers
ALTER TABLE guest_lists ADD COLUMN IF NOT EXISTS dj_id UUID REFERENCES dj_profiles(id) ON DELETE SET NULL;
ALTER TABLE guest_lists ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'vip'));
ALTER TABLE guest_lists ADD COLUMN IF NOT EXISTS price_cents INT NOT NULL DEFAULT 0;

-- Enhance signups with tier + check-in
ALTER TABLE guest_list_signups ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE guest_list_signups ADD COLUMN IF NOT EXISTS checked_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guest_list_signups ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- Waitlist table
CREATE TABLE IF NOT EXISTS guest_list_waitlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id   UUID NOT NULL REFERENCES guest_lists(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  party_size      INT NOT NULL DEFAULT 1,
  email           TEXT,
  phone           TEXT,
  position        INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'cancelled')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-increment follower count
CREATE OR REPLACE FUNCTION increment_follower_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dj_profiles SET follower_count = follower_count + 1 WHERE id = NEW.dj_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_follower_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dj_profiles SET follower_count = GREATEST(0, follower_count - 1) WHERE id = OLD.dj_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_dj_follow
  AFTER INSERT ON dj_follows
  FOR EACH ROW EXECUTE FUNCTION increment_follower_count();

CREATE TRIGGER on_dj_unfollow
  AFTER DELETE ON dj_follows
  FOR EACH ROW EXECUTE FUNCTION decrement_follower_count();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dj_profiles_user ON dj_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_dj_gigs_dj ON dj_gigs(dj_id);
CREATE INDEX IF NOT EXISTS idx_dj_gigs_club_date ON dj_gigs(club_id, gig_date);
CREATE INDEX IF NOT EXISTS idx_club_staff_user ON club_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_club_staff_club ON club_staff(club_id);
CREATE INDEX IF NOT EXISTS idx_dj_follows_user ON dj_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_dj_follows_dj ON dj_follows(dj_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_list ON guest_list_waitlist(guest_list_id);

-- RLS
ALTER TABLE dj_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dj_gigs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE dj_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_list_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view dj profiles" ON dj_profiles FOR SELECT USING (true);
CREATE POLICY "DJs manage own profile" ON dj_profiles FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Anyone can view gigs" ON dj_gigs FOR SELECT USING (true);
CREATE POLICY "Anyone can view staff" ON club_staff FOR SELECT USING (true);
CREATE POLICY "Users manage own follows" ON dj_follows FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Anyone can view follows" ON dj_follows FOR SELECT USING (true);
CREATE POLICY "Anyone can join waitlist" ON guest_list_waitlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view waitlist" ON guest_list_waitlist FOR SELECT USING (true);
