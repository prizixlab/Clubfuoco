-- Rumbalist purchases: every Rumbalist transaction that goes through Club Fuoco
-- (free guestlists + paid VIP tables). Distinct from the existing `bookings`
-- table so Rumbalist can be handed a single clean export — name, email, phone,
-- venue, product, price, event date — without RLS-gating other booking types.
CREATE TABLE IF NOT EXISTS rumbalist_purchases (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name           text,                                          -- snapshot from users at time of purchase
  email               text,                                          -- snapshot
  phone               text,                                          -- snapshot
  venue_id            text        NOT NULL,                          -- Rumbalist club key (UUID string)
  venue_name          text        NOT NULL,                          -- snapshot at time of purchase
  product_name        text        NOT NULL,                          -- e.g. 'Free Guestlist', 'VIP Table'
  product_kind        text        NOT NULL,                          -- 'free_guestlist' | 'vip_table'
  price_eur           numeric(10,2) NOT NULL DEFAULT 0,
  event_date          date        NOT NULL,                          -- the night the booking is for
  stripe_payment_intent_id text,                                     -- null for free guestlists
  booking_id          uuid        REFERENCES bookings(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rumbalist_purchases_venue_id_idx ON rumbalist_purchases (venue_id);
CREATE INDEX IF NOT EXISTS rumbalist_purchases_event_date_idx ON rumbalist_purchases (event_date);
CREATE INDEX IF NOT EXISTS rumbalist_purchases_user_id_idx  ON rumbalist_purchases (user_id);

ALTER TABLE rumbalist_purchases ENABLE ROW LEVEL SECURITY;

-- Users can see their own purchases (for a future "my Rumbalist activity" view).
DROP POLICY IF EXISTS "Users see own rumbalist purchases" ON rumbalist_purchases;
CREATE POLICY "Users see own rumbalist purchases"
  ON rumbalist_purchases FOR SELECT
  USING (auth.uid() = user_id);

-- Inserts only happen via service-role from /api/rumbalist/* — no anon insert.
-- (No INSERT policy = anon role blocked; service role bypasses RLS anyway.)
