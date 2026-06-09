-- ============================================================================
-- fix37 — account_transactions.transaction_number should hold the order number
-- ----------------------------------------------------------------------------
-- transaction_number was created as UUID, but the app stores the human order
-- number there (e.g. "ORD-20260609-00002"), which a UUID column rejects:
--   invalid input syntax for type uuid: "ORD-20260609-00002"
--
-- Convert it to VARCHAR(50) to match order_number. The table is empty so the
-- conversion is trivial; DROP DEFAULT removes any gen_random_uuid() default.
-- ============================================================================

ALTER TABLE account_transactions ALTER COLUMN transaction_number DROP DEFAULT;
ALTER TABLE account_transactions
  ALTER COLUMN transaction_number TYPE VARCHAR(50)
  USING transaction_number::text;
