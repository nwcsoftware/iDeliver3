-- =============================================================================
-- fix81 — Contact account numbers via the existing Chart of Accounts
-- -----------------------------------------------------------------------------
-- A contact had exactly ONE account number (contacts.account_number) and a
-- single all-or-nothing credit_debit_allowed flag. This lets every contact
-- (customer / supplier / partner) hold ANY NUMBER of account numbers, each cash
-- or credit, with its own maximum amount and expiry date.
--
-- These live in sub_accounts — the Chart of Accounts table that section 5 of
-- supabase-schema.sql already defines. It nearly models this already:
--
--   code           the account number          (existing)
--   name           the account's label         (existing)
--   contact_id     who it belongs to           (existing)
--   account_type   'cash' | 'credit'           (existing enum — already has both)
--   currency       the limit's currency        (existing)
--   credit_limit   the maximum amount          (existing)
--   is_active                                  (existing)
--
-- so this migration only adds what is genuinely missing:
--
--   expires_on     DATE     when the account stops being usable
--   is_primary     BOOLEAN  the contact's default account
--
-- The two "unlimited" rules, as specified:
--   credit_limit  0 or NULL = UNLIMITED (no ceiling)
--   expires_on    NULL      = NEVER expires
--
-- The limit's currency matters: balances are tracked per currency with no FX
-- conversion anywhere in this app, so a limit can only govern ONE currency —
-- which is why sub_accounts.currency already sits next to credit_limit.
--
-- major_account_id is NOT NULL, so every contact account needs a parent. One
-- "Contact Accounts" major account per company is created below to hold them,
-- keeping them grouped and out of the way of any other chart-of-accounts use.
--
-- current_balance is deliberately left at its default and never written: the
-- app derives balances live from closed orders and settlements (the same way
-- the Credit Customers page does), so a stored copy would only drift.
--
-- Safe to run multiple times.
-- =============================================================================

-- ── Undo the earlier, wrong fix81 ───────────────────────────────────────────
-- Earlier revisions of this file mistook sub_accounts for a free name and tried
-- to add their own columns to it. That run failed on major_account_id NOT NULL
-- and should have rolled back — this makes sure, on the chance it did not, and
-- is a harmless no-op otherwise. Only ever drops columns that fix81 itself
-- added; every column the Chart of Accounts came with is left alone.
ALTER TABLE sub_accounts DROP COLUMN IF EXISTS account_number;  -- duplicates `code`
ALTER TABLE sub_accounts DROP COLUMN IF EXISTS label;           -- duplicates `name`
ALTER TABLE sub_accounts DROP COLUMN IF EXISTS account_kind;    -- duplicates `account_type`
ALTER TABLE sub_accounts DROP COLUMN IF EXISTS notes;           -- duplicates `description`
ALTER TABLE sub_accounts DROP COLUMN IF EXISTS company_id;      -- comes via major_accounts
ALTER TABLE sub_accounts DROP COLUMN IF EXISTS updated_by;      -- not in this table's design
DROP INDEX IF EXISTS idx_sub_accounts_number;

-- ── What's actually missing ─────────────────────────────────────────────────
ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS expires_on DATE;             -- NULL = never expires
ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN sub_accounts.expires_on IS
  'Date this account stops accepting new charges. NULL = never expires.';
COMMENT ON COLUMN sub_accounts.is_primary IS
  'The contact''s default account. Orders/payments with a NULL sub_account_id bill to it.';
COMMENT ON COLUMN sub_accounts.credit_limit IS
  'Maximum outstanding amount, in this row''s currency. 0 or NULL = unlimited.';

-- At most one primary per contact (mirrors contact_addresses). Contact-less
-- chart-of-accounts rows are excluded — is_primary means nothing for them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_accounts_one_primary
  ON sub_accounts (contact_id) WHERE is_primary AND contact_id IS NOT NULL;

-- "This contact's accounts" — the tab's only read.
CREATE INDEX IF NOT EXISTS idx_sub_accounts_contact
  ON sub_accounts (contact_id) WHERE contact_id IS NOT NULL;

-- ── Let the app's anon key reach these tables ───────────────────────────────
-- Both tables already have RLS ENABLED and NO policies, which is why the app
-- read 0 rows from them without any error — RLS returns an empty set rather
-- than failing. Every other table the app touches carries a dev_anon policy for
-- exactly this reason; these two were never given one because nothing had read
-- them before now.
--
-- This only ADDS access. It cannot reduce anyone's: with RLS on and zero
-- policies, every non-superuser role (including authenticated) was already
-- denied everything here.
ALTER TABLE sub_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE major_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_anon_sub_accounts" ON sub_accounts;
CREATE POLICY "dev_anon_sub_accounts" ON sub_accounts
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- The app reads major_accounts to find the CONTACTS parent when creating an
-- account, so it needs read access here too.
DROP POLICY IF EXISTS "dev_anon_major_accounts" ON major_accounts;
CREATE POLICY "dev_anon_major_accounts" ON major_accounts
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── One "Contact Accounts" major account per company ────────────────────────
-- major_account_id is NOT NULL, so contact accounts need a parent. account_type
-- 'debit' — a contact's balance with us is a receivable.
INSERT INTO major_accounts (company_id, code, name, account_type, description)
SELECT c.id, 'CONTACTS', 'Contact Accounts', 'debit',
       'Parent for per-contact account numbers (fix81).'
FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

-- ── Which account an order bills to / a settlement pays down ────────────────
-- NULL on either means "the contact's PRIMARY account". That rule is what makes
-- this safe: every pre-existing order and payment is NULL, and the backfill
-- below makes each contact's current account_number its primary — so existing
-- history folds onto the account it already belonged to and today's balances
-- come out unchanged.
ALTER TABLE delivery_orders          ADD COLUMN IF NOT EXISTS sub_account_id UUID REFERENCES sub_accounts(id);
ALTER TABLE credit_customer_payments ADD COLUMN IF NOT EXISTS sub_account_id UUID REFERENCES sub_accounts(id);

CREATE INDEX IF NOT EXISTS idx_orders_sub_account
  ON delivery_orders (sub_account_id) WHERE sub_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_payments_sub_account
  ON credit_customer_payments (sub_account_id) WHERE sub_account_id IS NOT NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every contact with an account number gets it as a primary account on exactly
-- the terms it has today: unlimited, never expiring, and cash unless the contact
-- is credit-allowed (which is all credit_debit_allowed means right now).
--
-- NOT EXISTS keeps this re-runnable — a second run adds nothing. It is also why
-- there is no ON CONFLICT clause: the natural key here is (contact_id) among
-- primaries, not the table's own UNIQUE (major_account_id, code).
INSERT INTO sub_accounts (
  major_account_id, contact_id, code, name,
  account_type, currency, credit_limit, expires_on, is_primary, is_active, description
)
SELECT
  ma.id,
  c.id,
  c.account_number,
  'Main',
  (CASE WHEN c.credit_debit_allowed IS TRUE THEN 'credit' ELSE 'cash' END)::account_type,
  'USD'::currency_type,
  NULL,       -- unlimited: matches today's behaviour (no ceiling exists yet)
  NULL,       -- never expires
  TRUE,
  TRUE,
  'Backfilled from contacts.account_number (fix81).'
FROM contacts c
JOIN major_accounts ma
  ON ma.company_id = c.company_id AND ma.code = 'CONTACTS'
WHERE c.account_number IS NOT NULL
  AND btrim(c.account_number) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id
  );
