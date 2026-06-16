-- =============================================================================
-- fix51 — Driver daily settlements (replace ad-hoc ledger postings)
-- -----------------------------------------------------------------------------
-- The driver collects cash from customers in the field; an external app writes
-- each order's collected_usd / collected_lbp. This call-center app only settles
-- that cash back from the driver, order-by-order, once each order is closed.
--
-- Previously the Driver Dues page posted COLLECTION FROM DRIVER / DRIVER
-- REIMBURSEMENT lines to account_transactions (fix44). This switches the
-- settlement to the purpose-built driver_daily_settlements header (already in
-- the schema) plus a new driver_settlement_orders junction table — one line per
-- closed order — mirroring sales_invoices / sales_invoice_orders (fix22).
--
-- The call center enters the actual amount handed over per currency; any
-- shortfall/overage lands in difference_usd / difference_lbp on the header.
--
-- Safe to run multiple times.
-- =============================================================================

-- One line per settled order, linking it back to the daily settlement header.
CREATE TABLE IF NOT EXISTS driver_settlement_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id UUID NOT NULL REFERENCES driver_daily_settlements(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES delivery_orders(id),
  collected_usd DECIMAL(15,2) DEFAULT 0,
  collected_lbp DECIMAL(15,2) DEFAULT 0,
  retail_usd    DECIMAL(15,2) DEFAULT 0,
  retail_lbp    DECIMAL(15,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Per-order "is this order settled with the driver?" lookup (drops it off the
-- outstanding list once a settlement line exists).
CREATE INDEX IF NOT EXISTS idx_driver_settlement_orders_order
  ON driver_settlement_orders (order_id);

CREATE INDEX IF NOT EXISTS idx_driver_settlement_orders_settlement
  ON driver_settlement_orders (settlement_id);

-- Permissive dev RLS so the app's anon key can read/write both tables
-- (same dev_anon_* pattern as the rest of the schema).
ALTER TABLE driver_daily_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_driver_daily_settlements" ON driver_daily_settlements;
CREATE POLICY "dev_anon_driver_daily_settlements" ON driver_daily_settlements
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE driver_settlement_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_driver_settlement_orders" ON driver_settlement_orders;
CREATE POLICY "dev_anon_driver_settlement_orders" ON driver_settlement_orders
  FOR ALL TO anon USING (true) WITH CHECK (true);
