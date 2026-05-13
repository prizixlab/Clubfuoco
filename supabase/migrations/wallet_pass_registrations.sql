-- Apple Wallet Pass Web Service — device registrations
-- Run this in Supabase SQL editor before deploying the wallet push system.

CREATE TABLE IF NOT EXISTS wallet_pass_registrations (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_library_identifier text        NOT NULL,
  push_token                text        NOT NULL,
  pass_type_identifier      text        NOT NULL,
  serial_number             text        NOT NULL,
  user_id                   uuid        REFERENCES users(id) ON DELETE CASCADE,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- One row per device+serial combination; upsert on this key
  UNIQUE (device_library_identifier, serial_number)
);

-- Index for the common query: find all devices for a given serial number
CREATE INDEX IF NOT EXISTS idx_wallet_registrations_serial
  ON wallet_pass_registrations (serial_number, pass_type_identifier);

-- Index for listing passes for a specific device
CREATE INDEX IF NOT EXISTS idx_wallet_registrations_device
  ON wallet_pass_registrations (device_library_identifier, pass_type_identifier);

-- Service role only — no public access
ALTER TABLE wallet_pass_registrations ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed (only service role key touches this table)
