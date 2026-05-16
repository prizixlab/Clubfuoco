-- Sequential member numbers, assigned on first paid subscription
CREATE SEQUENCE IF NOT EXISTS member_number_seq START WITH 1001 INCREMENT BY 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_number int UNIQUE;

-- RPC called by the webhook to get the next number
CREATE OR REPLACE FUNCTION next_member_number()
RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT nextval('member_number_seq')::int;
$$;

-- Dedicated hosts / concierges (hired staff, managed in Supabase directly)
CREATE TABLE IF NOT EXISTS fuoco_hosts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  role             text NOT NULL DEFAULT 'Host',
  phone            text,            -- E.164, e.g. +34612345678
  whatsapp_url     text,            -- full wa.me link
  avatar_initial   char(1) NOT NULL,
  years_with_fuoco int,
  cities           text[],
  tiers            text[] NOT NULL DEFAULT '{sapphire,black}',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Which host is assigned to which member
CREATE TABLE IF NOT EXISTS member_host_assignments (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  host_id     uuid NOT NULL REFERENCES fuoco_hosts(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

-- Admins manage hosts; members can read their own assignment
ALTER TABLE fuoco_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_host_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads active hosts"
  ON fuoco_hosts FOR SELECT USING (is_active = true);

CREATE POLICY "users read own assignment"
  ON member_host_assignments FOR SELECT USING (auth.uid() = user_id);
