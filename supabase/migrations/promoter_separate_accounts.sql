-- Separate promoter identities (shared Supabase backend, enforced by kind).
-- A 'promoter' account can only use the promoter app; a 'user' account only
-- the consumer app. is_promoter = approved/verified for promoter accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'user';

-- Migrate existing approved promoters so they keep access under the new model.
UPDATE users SET account_kind = 'promoter'
 WHERE is_promoter = true AND account_kind <> 'promoter';

-- Instagram verification (manual review for now): a code the applicant DMs to
-- our IG, plus an admin-set verified flag.
ALTER TABLE promoter_applications
  ADD COLUMN IF NOT EXISTS ig_code     text,
  ADD COLUMN IF NOT EXISTS ig_verified boolean NOT NULL DEFAULT false;
