-- Paid front-page promotion opt-in. Billing (€0.30 per accepted guest, charged
-- one week after the event) is wired later; this just records the opt-in.
ALTER TABLE promoter_nights  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE promoter_series  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
