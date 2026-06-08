-- =============================================================================
-- fix22: Credit customers -> auto sales invoice on order close
--
-- 1. contacts.credit_debit_allowed: marks a contact as allowed to owe a balance
--    (buy on credit). The order form lets such customers close an order with an
--    unpaid balance, and records that balance as a sales_invoices row so it
--    surfaces in v_credit_customer_balances.
-- 2. Permissive dev RLS policies for sales_invoices / sales_invoice_orders so
--    the app's anon key can write them (same pattern as supabase-auth.sql).
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS credit_debit_allowed BOOLEAN DEFAULT FALSE;

ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_sales_invoices" ON sales_invoices;
CREATE POLICY "dev_anon_sales_invoices" ON sales_invoices
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE sales_invoice_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_sales_invoice_orders" ON sales_invoice_orders;
CREATE POLICY "dev_anon_sales_invoice_orders" ON sales_invoice_orders
  FOR ALL TO anon USING (true) WITH CHECK (true);
