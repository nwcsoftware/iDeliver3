-- =============================================================================
-- fix27: Customer authentication fields (hardening)
--
-- Guarantees every column / extension / index the customer mobile app's auth
-- flow relies on actually exists, so registration (customer_register_with_password),
-- login (verify_login), profile load and mobile-change all have what they need.
--
-- All statements are IF NOT EXISTS / idempotent — safe to run multiple times and
-- safe to run on a DB where these already exist (they become no-ops).
-- =============================================================================

-- ── Password hashing: crypt() / gen_salt() live in pgcrypto ──────────────────
-- verify_login and customer_register_with_password call crypt()/gen_salt('bf').
-- On Supabase pgcrypto lives in the `extensions` schema (both auth functions
-- set search_path = public, extensions). Ensure it is installed.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── contacts: customer profile + verification fields ─────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_photo_url    TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mobile_verified      BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS credit_debit_allowed BOOLEAN DEFAULT FALSE;

-- ── user_accounts: credential / login-state fields ───────────────────────────
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS password_hash        TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS failed_attempts      INTEGER DEFAULT 0;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS permissions          JSONB DEFAULT '{}';

-- ── Login lookups: verify_login matches on username / email / mobile ─────────
CREATE INDEX IF NOT EXISTS idx_user_accounts_username ON user_accounts(username);
CREATE INDEX IF NOT EXISTS idx_user_accounts_mobile   ON user_accounts(mobile);
CREATE INDEX IF NOT EXISTS idx_user_accounts_email    ON user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_mobile        ON contacts(mobile);

-- ── Re-affirm execute grants for the anon/authenticated app roles ────────────
-- (No-ops if the functions/grants already exist; signatures match step1 / fix17.)
DO $$
BEGIN
  IF to_regprocedure('public.customer_register_with_password(uuid,text,text,text,text,text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.customer_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
  END IF;
  IF to_regprocedure('public.customer_update_mobile(uuid,uuid,text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.customer_update_mobile(UUID, UUID, TEXT) TO anon, authenticated;
  END IF;
  IF to_regprocedure('public.verify_login(text,text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon, authenticated;
  END IF;
END $$;
