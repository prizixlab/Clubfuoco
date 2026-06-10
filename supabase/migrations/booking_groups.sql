-- ── Group bookings ────────────────────────────────────────────────────────────
-- An organizer creates a group for a club + night, invites friends, and decides
-- per-member who pays. Each member's actual entry reuses the existing `bookings`
-- table (one row per person, own QR), linked back via booking_group_members.
--
-- API routes operate with the service client scoped to the authed user, so RLS
-- here is defence-in-depth.

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
                                  CHECK (rsvp IN ('invited', 'going', 'declined')),
  payment_required  boolean     NOT NULL DEFAULT false,
  -- Exact euros this member owes. NULL = derive from the club's per-person price
  -- when payment_required (standard general-entry groups). A set value is the
  -- organizer's custom allocation (e.g. splitting a VIP table their own way).
  amount_due        numeric,
  paid              boolean     NOT NULL DEFAULT false,
  booking_id        uuid        REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS booking_groups_organizer_idx ON public.booking_groups(organizer_id);
CREATE INDEX IF NOT EXISTS booking_groups_code_idx      ON public.booking_groups(invite_code);
CREATE INDEX IF NOT EXISTS group_members_group_idx      ON public.booking_group_members(group_id);
CREATE INDEX IF NOT EXISTS group_members_user_idx       ON public.booking_group_members(user_id);

ALTER TABLE public.booking_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_group_members ENABLE ROW LEVEL SECURITY;

-- Organizer or any member can see the group
DROP POLICY IF EXISTS "See groups you're in" ON public.booking_groups;
CREATE POLICY "See groups you're in"
  ON public.booking_groups FOR SELECT
  USING (
    auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM public.booking_group_members m
               WHERE m.group_id = id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Organizer creates groups" ON public.booking_groups;
CREATE POLICY "Organizer creates groups"
  ON public.booking_groups FOR INSERT
  WITH CHECK (auth.uid() = organizer_id);

DROP POLICY IF EXISTS "Organizer updates groups" ON public.booking_groups;
CREATE POLICY "Organizer updates groups"
  ON public.booking_groups FOR UPDATE
  USING (auth.uid() = organizer_id);

-- Members rows: a user can see rows of groups they belong to
DROP POLICY IF EXISTS "See members of your groups" ON public.booking_group_members;
CREATE POLICY "See members of your groups"
  ON public.booking_group_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.booking_groups g
               WHERE g.id = group_id AND g.organizer_id = auth.uid())
  );

DROP POLICY IF EXISTS "Manage own membership" ON public.booking_group_members;
CREATE POLICY "Manage own membership"
  ON public.booking_group_members FOR UPDATE
  USING (user_id = auth.uid());
