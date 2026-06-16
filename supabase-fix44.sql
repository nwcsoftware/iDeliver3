-- ============================================================================
-- fix44 — Driver daily dues / cash encashment postings
-- ----------------------------------------------------------------------------
-- The "Driver Dues" page lets the call-center user reconcile the cash a driver
-- collected from customers during the day against the closed orders, and post
-- the settlement to account_transactions (no new table — reuses the existing
-- ledger with two new transaction_type values):
--
--   'COLLECTION FROM DRIVER'  → money IN  (credit_amount): cash the driver hands
--                               back to the office, one line per closed order
--                               carrying that order's collected amount.
--   'DRIVER REIMBURSEMENT'    → money OUT (debit_amount): petty cash paid back to
--                               the driver for an external retail (market) invoice
--                               he settled from his own pocket, one line per
--                               retail_goods_invoices row.
--
-- An order is considered "settled with the driver" once either of those lines
-- exists for it, so it drops off the outstanding list. This partial index makes
-- that per-order lookup cheap.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_account_transactions_driver_settlement
  ON account_transactions (order_id)
  WHERE transaction_type IN ('COLLECTION FROM DRIVER', 'DRIVER REIMBURSEMENT');
