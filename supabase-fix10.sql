-- =============================================================================
-- fix10: Customer account numbers (OPTIONAL)
--
-- The account_number column was added to `contacts` manually, and account
-- numbers are now generated CLIENT-SIDE (max existing + 1, 12-digit padded),
-- so NO sequence or trigger is required.
--
-- This file only adds a UNIQUE index so two customers can never end up with
-- the same account number (a safety net against the rare race where two are
-- created at the exact same moment). Running it is recommended but optional.
-- =============================================================================

-- Safe no-op if the column already exists.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS account_number VARCHAR(20);

-- Enforce uniqueness among non-null account numbers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_number
  ON contacts(account_number) WHERE account_number IS NOT NULL;
