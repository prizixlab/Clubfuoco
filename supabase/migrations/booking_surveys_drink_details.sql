-- Add drink sub-kinds (jsonb map) and free-text other field to booking_surveys
ALTER TABLE booking_surveys
  ADD COLUMN IF NOT EXISTS drink_kinds  jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS other_drinks text  NOT NULL DEFAULT '';
