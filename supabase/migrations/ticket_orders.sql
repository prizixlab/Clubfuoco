-- Ticket orders: external events purchased through Club Fuoco at 10% markup
CREATE TABLE IF NOT EXISTS ticket_orders (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform               text        NOT NULL,                       -- 'ra', 'eventbrite', 'manual'
  platform_event_id      text,
  event_name             text        NOT NULL,
  venue_name             text        NOT NULL,
  venue_place_id         text,                                       -- Google place_id
  event_date             timestamptz,
  quantity               int         NOT NULL DEFAULT 1,
  base_price_cents       int         NOT NULL,
  markup_cents           int         NOT NULL,
  total_cents            int         NOT NULL,
  stripe_payment_intent  text,
  status                 text        NOT NULL DEFAULT 'pending',     -- pending | paid | fulfilled | cancelled | payment_failed
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ticket_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own ticket orders" ON ticket_orders;
CREATE POLICY "Users see own ticket orders"
  ON ticket_orders FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create own ticket orders" ON ticket_orders;
CREATE POLICY "Users create own ticket orders"
  ON ticket_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);
