-- ── Friendships ───────────────────────────────────────────────────────────────
-- A directed request row models the relationship between two users. A friendship
-- between A and B is ONE row (requester → addressee). "My friends" = accepted
-- rows where I'm either party; the friend is the opposite column.
--
-- API routes read/write this with the service client (scoped by the authed user)
-- because cross-user reads (friend names, search) are blocked by the per-user
-- RLS on public.users. RLS below is still defined as defence-in-depth.

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

-- Either party can see the row
DROP POLICY IF EXISTS "Users see own friendships" ON public.friendships;
CREATE POLICY "Users see own friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- You may only create a request as the requester
DROP POLICY IF EXISTS "Users send own requests" ON public.friendships;
CREATE POLICY "Users send own requests"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- Either party can update (addressee accepts; either can touch their own row)
DROP POLICY IF EXISTS "Users update own friendships" ON public.friendships;
CREATE POLICY "Users update own friendships"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Either party can remove (cancel request, decline, or unfriend)
DROP POLICY IF EXISTS "Users delete own friendships" ON public.friendships;
CREATE POLICY "Users delete own friendships"
  ON public.friendships FOR DELETE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
