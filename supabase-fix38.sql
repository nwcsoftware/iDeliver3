-- ============================================================================
-- fix38 — Drop the UNIQUE constraint on account_transactions.transaction_number
-- ----------------------------------------------------------------------------
-- transaction_number now holds the order number, and every line of an order
-- carries the same order number, so the values are intentionally repeated.
-- The leftover UNIQUE constraint (from when it was a UUID id) blocks that:
--   duplicate key value violates unique constraint
--   "account_transactions_transaction_number_key"
-- ============================================================================

ALTER TABLE account_transactions
  DROP CONSTRAINT IF EXISTS account_transactions_transaction_number_key;
