-- =============================================================================
-- fix64 — Credit-customer statement clears (carry-forward checkpoints)
-- -----------------------------------------------------------------------------
-- Lets the user "clear" a credit customer's statement up to a date (e.g. as of
-- yesterday). After that, the Credit Customers statement opens with a single
-- "Standing balance brought forward" line for everything dated on/before the
-- clear date, then lists only the newer orders & payments. A "Show all" toggle
-- still expands the full history — nothing is deleted.
--
--   credit_customer_clears — one row per clear action. The ACTIVE checkpoint for
--                            a customer is the row with the latest cleared_through.
--
-- dev_anon RLS so the app's anon key can read/write, matching the rest of the
-- schema. Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS credit_customer_clears (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID REFERENCES companies(id),
  customer_id      UUID NOT NULL REFERENCES contacts(id),
  cleared_through  DATE NOT NULL,                 -- statement cleared up to & including this date
  created_by       UUID REFERENCES user_accounts(id),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- "Latest clear for this customer" lookups.
CREATE INDEX IF NOT EXISTS idx_credit_customer_clears_customer
  ON credit_customer_clears (customer_id, cleared_through DESC);

ALTER TABLE credit_customer_clears ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_credit_customer_clears" ON credit_customer_clears;
CREATE POLICY "dev_anon_credit_customer_clears" ON credit_customer_clears
  FOR ALL TO anon USING (true) WITH CHECK (true);
