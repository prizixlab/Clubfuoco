-- Promoter billing for paid front-page promotion.
-- Model: save a card on file (Stripe), charge off-session one week after the
-- event for (accepted headcount × €0.30). On failure the balance goes negative
-- and the account is gated until settled. No processor can force a failing
-- card, so enforcement = debt ledger + access lock + retries.

CREATE TABLE IF NOT EXISTS promoter_billing_accounts (
  user_id                   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id        text,
  default_payment_method_id text,
  card_verified             boolean NOT NULL DEFAULT false,
  card_brand                text,
  card_last4                text,
  balance_cents             int NOT NULL DEFAULT 0,   -- negative = owes us
  status                    text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','past_due','blocked')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE promoter_billing_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own billing read" ON promoter_billing_accounts;
CREATE POLICY "own billing read" ON promoter_billing_accounts
  FOR SELECT USING (user_id = auth.uid());
-- All writes go through service-role endpoints (no user write policy).

CREATE TABLE IF NOT EXISTS promoter_billing_charges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  night_id                 uuid REFERENCES promoter_nights(id) ON DELETE SET NULL,
  event_date               date NOT NULL,
  accepted_count           int  NOT NULL DEFAULT 0,
  rate_cents               int  NOT NULL DEFAULT 30,
  amount_cents             int  NOT NULL DEFAULT 0,
  due_at                   timestamptz NOT NULL,      -- midnight of event + 7 days
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','charged','failed','waived')),
  stripe_payment_intent_id text,
  attempts                 int  NOT NULL DEFAULT 0,
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  charged_at               timestamptz,
  UNIQUE (night_id)
);

ALTER TABLE promoter_billing_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own charges read" ON promoter_billing_charges;
CREATE POLICY "own charges read" ON promoter_billing_charges
  FOR SELECT USING (promoter_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_billing_charges_due
  ON promoter_billing_charges(due_at) WHERE status = 'pending';
