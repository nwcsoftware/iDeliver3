-- =============================================================================
-- fix63 — Credit-customer account payments (account-level dues collection)
-- -----------------------------------------------------------------------------
-- Credit customers (contacts.credit_debit_allowed = TRUE) can have their orders
-- closed with an unpaid balance, then settle several orders together with a
-- single payment later on. That payment is recorded against the CUSTOMER ACCOUNT,
-- not any one order — so a 1000 balance can be paid 750 now, leaving 250 pending.
--
--   credit_customer_payments — one row per receipt taken from a credit customer.
--                              amount + currency (multi-currency, like driver
--                              settlements / cashier box). Not linked to an order.
--
-- A customer's balance per currency, shown on the Credit Customers page, is:
--     SUM(closed-order totals)  −  SUM(credit_customer_payments)
--
-- dev_anon RLS so the app's anon key can read/write, matching the rest of the
-- schema. Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS credit_customer_payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID REFERENCES companies(id),
  customer_id       UUID NOT NULL REFERENCES contacts(id),
  amount            DECIMAL(15,2) NOT NULL,
  currency          currency_type DEFAULT 'USD',
  method            VARCHAR(30) DEFAULT 'cash',
  paid_at           TIMESTAMPTZ DEFAULT NOW(),
  notes             TEXT,
  collected_by      UUID REFERENCES user_accounts(id),
  collected_by_name TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Fast "all payments for this customer" lookups (statement + balance).
CREATE INDEX IF NOT EXISTS idx_credit_customer_payments_customer
  ON credit_customer_payments (customer_id);

-- Permissive dev RLS so the app's anon key can read/write (same dev_anon_*
-- pattern as the rest of the schema).
ALTER TABLE credit_customer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_credit_customer_payments" ON credit_customer_payments;
CREATE POLICY "dev_anon_credit_customer_payments" ON credit_customer_payments
  FOR ALL TO anon USING (true) WITH CHECK (true);
