-- ═══════════════════════════════════════════════════════════════════════════
-- Club Fuoco — Friends + Group bookings + RSVP, complete setup.
-- Idempotent: safe to run on a fresh DB or over partial earlier runs.
-- Paste this whole file once into Supabase → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Friendships ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friendships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships(addressee_id);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own friendships" ON public.friendships;
CREATE POLICY "Users see own friendships" ON public.friendships FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
DROP POLICY IF EXISTS "Users send own requests" ON public.friendships;
CREATE POLICY "Users send own requests" ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);
DROP POLICY IF EXISTS "Users update own friendships" ON public.friendships;
CREATE POLICY "Users update own friendships" ON public.friendships FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
DROP POLICY IF EXISTS "Users delete own friendships" ON public.friendships;
CREATE POLICY "Users delete own friendships" ON public.friendships FOR DELETE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- ── 2. Group bookings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_groups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid        NOT NULL REFERENCES public.clubs(id),
  organizer_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  booking_type  text        NOT NULL CHECK (booking_type IN ('general', 'vip')),
  booking_date  date        NOT NULL,
  invite_code   text        NOT NULL UNIQUE,
  status        text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'closed', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_group_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid        NOT NULL REFERENCES public.booking_groups(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role              text        NOT NULL DEFAULT 'member'
                                  CHECK (role IN ('organizer', 'member')),
  rsvp              text        NOT NULL DEFAULT 'invited'
                                  CHECK (rsvp IN ('invited', 'going', 'maybe', 'declined')),
  payment_required  boolean     NOT NULL DEFAULT false,
  amount_due        numeric,
  paid              boolean     NOT NULL DEFAULT false,
  booking_id        uuid        REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- Upgrades for tables created by an earlier partial run:
ALTER TABLE public.booking_group_members ADD COLUMN IF NOT EXISTS amount_due numeric;
ALTER TABLE public.booking_group_members DROP CONSTRAINT IF EXISTS booking_group_members_rsvp_check;
ALTER TABLE public.booking_group_members ADD CONSTRAINT booking_group_members_rsvp_check
  CHECK (rsvp IN ('invited', 'going', 'maybe', 'declined'));

CREATE INDEX IF NOT EXISTS booking_groups_organizer_idx ON public.booking_groups(organizer_id);
CREATE INDEX IF NOT EXISTS booking_groups_code_idx      ON public.booking_groups(invite_code);
CREATE INDEX IF NOT EXISTS group_members_group_idx      ON public.booking_group_members(group_id);
CREATE INDEX IF NOT EXISTS group_members_user_idx       ON public.booking_group_members(user_id);

ALTER TABLE public.booking_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "See groups you're in" ON public.booking_groups;
CREATE POLICY "See groups you're in" ON public.booking_groups FOR SELECT
  USING (auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM public.booking_group_members m
               WHERE m.group_id = id AND m.user_id = auth.uid()));
DROP POLICY IF EXISTS "Organizer creates groups" ON public.booking_groups;
CREATE POLICY "Organizer creates groups" ON public.booking_groups FOR INSERT
  WITH CHECK (auth.uid() = organizer_id);
DROP POLICY IF EXISTS "Organizer updates groups" ON public.booking_groups;
CREATE POLICY "Organizer updates groups" ON public.booking_groups FOR UPDATE
  USING (auth.uid() = organizer_id);

DROP POLICY IF EXISTS "See members of your groups" ON public.booking_group_members;
CREATE POLICY "See members of your groups" ON public.booking_group_members FOR SELECT
  USING (user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.booking_groups g
               WHERE g.id = group_id AND g.organizer_id = auth.uid()));
DROP POLICY IF EXISTS "Manage own membership" ON public.booking_group_members;
CREATE POLICY "Manage own membership" ON public.booking_group_members FOR UPDATE
  USING (user_id = auth.uid());
