-- =============================================================================
-- fix28: Customer sign-in credentials on contacts
--
-- Adds username + password_hash directly on the contacts table so a customer's
-- mobile-app login can be authenticated against their contact record (instead
-- of / in addition to the user_accounts table).
--
--   * username      — the login identifier (typically the mobile number or email)
--   * password_hash — bcrypt hash produced with crypt(pwd, gen_salt('bf', 12))
--
-- A partial, case-insensitive UNIQUE index prevents two contacts sharing a login
-- while still allowing the many contacts that have no credentials (NULL username).
--
-- All statements are idempotent — safe to run multiple times.
-- =============================================================================

-- crypt()/gen_salt() for hashing/verifying the password live in pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS username      VARCHAR(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Unique login, enforced only for contacts that actually have one, and
-- case-insensitive so "John@x.com" and "john@x.com" can't both register.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_username_unique
  ON contacts (lower(username))
  WHERE username IS NOT NULL;
