-- Make account deletion (GDPR right-to-erasure) actually work.
--
-- Background: POST /api/account/delete and Supabase Studio's "delete user"
-- both failed with "Database error deleting user" for any account that had
-- a row in public.bookings (and several other tables). Cause: those tables'
-- FKs to public.users(id) were declared without ON DELETE, so Postgres'
-- default NO ACTION blocked the cascade chain
-- auth.users → public.users → owned rows.
--
-- Policy:
--   • Owned data (the user's own bookings, memberships, reviews, …)
--       → ON DELETE CASCADE  (right-to-erasure: their data goes with them).
--   • Audit trails (columns ending in _by, plus owner_user_id)
--       → ON DELETE SET NULL (keep the historical row, anonymize the link).
--
-- This migration is idempotent: it drops the existing FK by name (looked up
-- via pg_constraint, so non-standard names are handled) and recreates it
-- with the right ON DELETE action. Running it twice is a no-op.
--
-- The safety-net block at the end auto-applies the policy to ANY remaining
-- FK to public.users(id) still in NO ACTION / RESTRICT — this covers tables
-- created via Supabase Studio that aren't in this repo's migration files
-- (notifications, push_subscriptions, payment_methods, etc.).

-- ── Helper: drop ALL FKs on (table, column) pointing at users, then add
--    a single new one with the requested ON DELETE action. Idempotent. ──────
CREATE OR REPLACE FUNCTION pg_temp.fix_user_fk(
  p_table  text,
  p_column text,
  p_action text          -- 'CASCADE' or 'SET NULL'
) RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  -- Drop any existing FK on this column that references public.users
  FOR r IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class       cls    ON cls.oid    = con.conrelid
    JOIN   pg_namespace   nsp    ON nsp.oid    = cls.relnamespace
    JOIN   pg_class       ref    ON ref.oid    = con.confrelid
    JOIN   pg_namespace   refnsp ON refnsp.oid = ref.relnamespace
    JOIN   pg_attribute   att    ON att.attrelid = cls.oid
                                AND att.attnum   = ANY(con.conkey)
    WHERE  con.contype  = 'f'
      AND  nsp.nspname  = 'public' AND cls.relname = p_table
      AND  refnsp.nspname = 'public' AND ref.relname = 'users'
      AND  att.attname  = p_column
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
                   p_table, r.conname);
  END LOOP;

  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I
       FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE %s',
    p_table,
    p_table || '_' || p_column || '_fkey',
    p_column,
    p_action
  );
END;
$$ LANGUAGE plpgsql;


-- ── 1. Named fixes (everything declared in this repo's migrations) ─────────

-- Owned data → CASCADE
SELECT pg_temp.fix_user_fk('bookings',    'user_id', 'CASCADE');
SELECT pg_temp.fix_user_fk('memberships', 'user_id', 'CASCADE');
SELECT pg_temp.fix_user_fk('reviews',     'user_id', 'CASCADE');

-- Audit trails → SET NULL (columns are nullable in the existing schema)
SELECT pg_temp.fix_user_fk('bookings',    'checked_in_by', 'SET NULL');
SELECT pg_temp.fix_user_fk('clubs',       'owner_user_id', 'SET NULL');
SELECT pg_temp.fix_user_fk('live_status', 'updated_by',    'SET NULL');
SELECT pg_temp.fix_user_fk('rumbas',      'created_by',    'SET NULL');
SELECT pg_temp.fix_user_fk('rumbas',      'checked_in_by', 'SET NULL');


-- ── 2. Safety net: any other FK to public.users(id) left in NO ACTION ─────
-- Catches tables created via Studio that aren't in this repo's migrations
-- (notifications, push_subscriptions, payment_methods, etc.). Column name
-- decides the policy: '_by' suffix or 'owner_*' / 'created_*' → SET NULL
-- (only if column is nullable); everything else → CASCADE.

DO $$
DECLARE
  r RECORD;
  new_action text;
BEGIN
  FOR r IN
    SELECT con.conname,
           cls.relname  AS table_name,
           att.attname  AS column_name,
           att.attnotnull
    FROM   pg_constraint con
    JOIN   pg_class       cls    ON cls.oid    = con.conrelid
    JOIN   pg_namespace   nsp    ON nsp.oid    = cls.relnamespace
    JOIN   pg_class       ref    ON ref.oid    = con.confrelid
    JOIN   pg_namespace   refnsp ON refnsp.oid = ref.relnamespace
    JOIN   pg_attribute   att    ON att.attrelid = cls.oid
                                AND att.attnum   = con.conkey[1]
    WHERE  con.contype  = 'f'
      AND  nsp.nspname  = 'public'
      AND  refnsp.nspname = 'public' AND ref.relname = 'users'
      AND  con.confdeltype IN ('a', 'r')      -- a = NO ACTION, r = RESTRICT
      AND  array_length(con.conkey, 1) = 1    -- single-column FKs only
  LOOP
    IF (r.column_name ~ '_by$'
        OR r.column_name LIKE 'owner_%'
        OR r.column_name LIKE 'created_%')
       AND NOT r.attnotnull THEN
      new_action := 'SET NULL';
    ELSE
      new_action := 'CASCADE';
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
                   r.table_name, r.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I
         FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE %s',
      r.table_name,
      r.table_name || '_' || r.column_name || '_fkey',
      r.column_name,
      new_action
    );
    RAISE NOTICE 'safety-net: %.% → ON DELETE %',
                 r.table_name, r.column_name, new_action;
  END LOOP;
END $$;
