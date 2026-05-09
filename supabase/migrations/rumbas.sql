-- ============================================================
-- CLUB FUOCO — Rumbas (Guest List) Feature
-- ============================================================

-- Add staff role support to users (extend existing role enum)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
-- Note: role values: 'user' | 'staff' | 'admin' (in addition to existing club_staff, club_owner)

CREATE TABLE IF NOT EXISTS rumbas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text        NOT NULL,
  venue_name      text        NOT NULL,
  venue_place_id  text,
  event_date      timestamptz NOT NULL,
  capacity        int         NOT NULL DEFAULT 100,
  description     text,
  cover_image     text,
  dress_code      text,
  is_active       boolean     NOT NULL DEFAULT false,
  created_by      uuid        REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rumba_signups (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rumba_id        uuid        NOT NULL REFERENCES rumbas(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  email           text        NOT NULL,
  plus_ones       int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'confirmed', -- confirmed | arrived | denied
  checked_in_at   timestamptz,
  checked_in_by   uuid        REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rumba_id, user_id)
);

ALTER TABLE rumbas ENABLE ROW LEVEL SECURITY;
ALTER TABLE rumba_signups ENABLE ROW LEVEL SECURITY;

-- Users can read active rumbas
CREATE POLICY "Anyone reads active rumbas" ON rumbas FOR SELECT USING (is_active = true);
-- Staff/admin can do everything on rumbas
CREATE POLICY "Staff manage rumbas" ON rumbas FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('staff','admin'))
);

-- Users can read/insert their own signups
CREATE POLICY "Users see own signups" ON rumba_signups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own signups" ON rumba_signups FOR INSERT WITH CHECK (auth.uid() = user_id);
-- Staff can read/update all signups
CREATE POLICY "Staff manage signups" ON rumba_signups FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('staff','admin'))
);
