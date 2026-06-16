-- ============================================================================
-- fix49 — payment_collections: single amount + currency
-- ----------------------------------------------------------------------------
-- payment_collections stored two fixed columns (amount_usd, amount_lbp), one
-- per supported currency, so a payment could only ever be USD or LBP. This
-- switches to a single `amount` column plus a `currency` (currency_type), so an
-- order can collect payments in any currency (USD, LBP, EUR, …).
--
-- Migration:
--   1. rename amount_usd → amount (USD rows keep their value, currency 'USD').
--   2. add currency (currency_type, default 'USD').
--   3. move any LBP-only rows into amount + currency 'LBP'.
--   4. drop the now-redundant amount_lbp column.
-- ============================================================================

ALTER TABLE payment_collections RENAME COLUMN amount_usd TO amount;

ALTER TABLE payment_collections
  ADD COLUMN IF NOT EXISTS currency currency_type DEFAULT 'USD';

UPDATE payment_collections
  SET amount = amount_lbp, currency = 'LBP'
  WHERE COALESCE(amount_lbp, 0) <> 0 AND COALESCE(amount, 0) = 0;

ALTER TABLE payment_collections DROP COLUMN IF EXISTS amount_lbp;
