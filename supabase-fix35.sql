-- ============================================================================
-- fix35 — Allow writes to account_transactions (RLS policy)
-- ----------------------------------------------------------------------------
-- account_transactions has row-level security enabled but no policy for the
-- anon role, so PostgREST rejects every insert:
--   "new row violates row-level security policy for table account_transactions"
--
-- This adds the same dev_anon FOR ALL policy used by the other app tables
-- (contacts, delivery_orders, retail_goods_invoices, …), letting the app post
-- order lines on "Mark Closed".
-- ============================================================================

ALTER TABLE account_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_account_transactions" ON account_transactions;
CREATE POLICY "dev_anon_account_transactions" ON account_transactions
  FOR ALL TO anon USING (true) WITH CHECK (true);
