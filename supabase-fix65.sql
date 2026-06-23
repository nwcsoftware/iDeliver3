-- =============================================================================
-- fix65 — Credit-customer order exclusions (admin: remove an order from the
--          credit statement without deleting the order)
-- -----------------------------------------------------------------------------
-- On the Credit Customers page an admin can erase settlement records:
--   • a single account payment        → DELETE from credit_customer_payments
--   • all payments + checkpoints      → DELETE the customer's rows in
--                                       credit_customer_payments + credit_customer_clears
--   • a single order from the account → recorded here (the order itself is kept;
--                                       it still shows in Closed Orders / reports)
--
--   credit_excluded_orders — one row per order excluded from its customer's credit
--                            account/statement. ON DELETE CASCADE so deleting the
--                            order later cleans this up automatically.
--
-- dev_anon RLS so the app's anon key can read/write, matching the rest of the
-- schema. Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS credit_excluded_orders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID REFERENCES companies(id),
  order_id         UUID NOT NULL UNIQUE REFERENCES delivery_orders(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES contacts(id),
  excluded_by      UUID REFERENCES user_accounts(id),
  excluded_by_name TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_excluded_orders_customer
  ON credit_excluded_orders (customer_id);

ALTER TABLE credit_excluded_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_credit_excluded_orders" ON credit_excluded_orders;
CREATE POLICY "dev_anon_credit_excluded_orders" ON credit_excluded_orders
  FOR ALL TO anon USING (true) WITH CHECK (true);
