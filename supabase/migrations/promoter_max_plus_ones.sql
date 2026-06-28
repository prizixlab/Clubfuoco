-- Per-guest plus-one cap. NULL = no limit.
ALTER TABLE promoter_nights  ADD COLUMN IF NOT EXISTS max_plus_ones int;
ALTER TABLE promoter_series  ADD COLUMN IF NOT EXISTS max_plus_ones int;
