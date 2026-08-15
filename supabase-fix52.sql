-- =============================================================================
-- fix52 — Collection / settlement chain: per-currency rows (amount + currency)
-- -----------------------------------------------------------------------------
-- The transaction tables already store money as a single amount + currency_type
-- (order_items, delivery_packages, and payment_collections after fix49). This
-- finishes the job for the collection -> settlement rollup, which still used
-- fixed _usd / _lbp column pairs, so a new currency (EUR is already in the
-- currency_type enum) no longer needs any schema change.
--
--   1. delivery_orders.collected_* — dropped; the order's collected amount is
--      now derived from payment_collections (amount + currency).
--   2. driver_daily_settlements — drops its fixed per-currency money columns;
--      the header keeps only meta (driver, date, totals count, received_by …).
--   3. driver_settlement_currency_totals (new) — header money, one row per
--      (settlement, currency): total_collected, amount_paid, difference.
--   4. driver_settlement_orders — rebuilt as one row per (order, currency):
--      collected + retail (was fixed _usd/_lbp columns in fix51).
--
-- Supersedes the table shapes from fix51. Safe to run multiple times.
-- =============================================================================

-- 0. Two reporting views read delivery_orders.collected_usd/lbp directly, which
--    blocks dropping those columns. Redefine them first to derive collected from
--    payment_collections (same output columns), so the columns can be dropped.
CREATE OR REPLACE VIEW v_daily_order_summary AS
SELECT
  do2.company_id,
  do2.branch_id,
  DATE(do2.created_at)                        AS report_date,
  do2.driver_id,
  c.first_name || ' ' || c.last_name          AS driver_name,
  COUNT(do2.id)                               AS total_orders,
  SUM(do2.total_amount)                       AS total_value,
  COALESCE(SUM(pc.collected_usd), 0)          AS collected_usd,
  COALESCE(SUM(pc.collected_lbp), 0)          AS collected_lbp,
  SUM(CASE WHEN do2.status = 'delivered'  THEN 1 ELSE 0 END) AS delivered_count,
  SUM(CASE WHEN do2.status = 'cancelled'  THEN 1 ELSE 0 END) AS cancelled_count
FROM delivery_orders do2
LEFT JOIN contacts c ON c.id = do2.driver_id
LEFT JOIN (
  SELECT order_id,
    SUM(amount) FILTER (WHERE currency = 'USD') AS collected_usd,
    SUM(amount) FILTER (WHERE currency = 'LBP') AS collected_lbp
  FROM payment_collections GROUP BY order_id
) pc ON pc.order_id = do2.id
GROUP BY do2.company_id, do2.branch_id, DATE(do2.created_at), do2.driver_id, driver_name;

CREATE OR REPLACE VIEW v_driver_due_to_pay AS
SELECT
  do2.driver_id,
  c.first_name || ' ' || c.last_name         AS driver_name,
  c.mobile                                   AS driver_mobile,
  DATE(do2.delivered_at)                     AS delivery_date,
  COUNT(do2.id)                              AS orders_count,
  SUM(do2.total_amount)                      AS total_to_collect,
  COALESCE(SUM(pc.collected_usd), 0)         AS collected_usd,
  COALESCE(SUM(pc.collected_lbp), 0)         AS collected_lbp,
  SUM(do2.total_amount) - COALESCE(SUM(pc.collected_usd), 0) AS balance_usd
FROM delivery_orders do2
JOIN contacts c ON c.id = do2.driver_id
LEFT JOIN (
  SELECT order_id,
    SUM(amount) FILTER (WHERE currency = 'USD') AS collected_usd,
    SUM(amount) FILTER (WHERE currency = 'LBP') AS collected_lbp
  FROM payment_collections GROUP BY order_id
) pc ON pc.order_id = do2.id
WHERE do2.payment_status IN ('collected_by_driver', 'due_for_collection')
GROUP BY do2.driver_id, driver_name, driver_mobile, DATE(do2.delivered_at);

-- 1. Order collected totals are derived from payment_collections now.
ALTER TABLE delivery_orders DROP COLUMN IF EXISTS collected_usd;
ALTER TABLE delivery_orders DROP COLUMN IF EXISTS collected_lbp;

-- 2. Settlement header: drop fixed per-currency money columns (moved to child).
ALTER TABLE driver_daily_settlements DROP COLUMN IF EXISTS total_collected_usd;
ALTER TABLE driver_daily_settlements DROP COLUMN IF EXISTS total_collected_lbp;
ALTER TABLE driver_daily_settlements DROP COLUMN IF EXISTS amount_paid_usd;
ALTER TABLE driver_daily_settlements DROP COLUMN IF EXISTS amount_paid_lbp;
ALTER TABLE driver_daily_settlements DROP COLUMN IF EXISTS difference_usd;
ALTER TABLE driver_daily_settlements DROP COLUMN IF EXISTS difference_lbp;

-- 3. Header money, one row per (settlement, currency).
CREATE TABLE IF NOT EXISTS driver_settlement_currency_totals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id   UUID NOT NULL REFERENCES driver_daily_settlements(id) ON DELETE CASCADE,
  currency        currency_type NOT NULL,
  total_collected DECIMAL(15,2) DEFAULT 0,   -- gross collected from the orders
  amount_paid     DECIMAL(15,2) DEFAULT 0,   -- cash the driver actually handed over
  difference      DECIMAL(15,2) DEFAULT 0,   -- amount_paid − net (negative = shortfall)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_settlement_currency_totals_settlement
  ON driver_settlement_currency_totals (settlement_id);

-- 4. Per-order settlement lines, one row per (order, currency).
DROP TABLE IF EXISTS driver_settlement_orders;
CREATE TABLE driver_settlement_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id UUID NOT NULL REFERENCES driver_daily_settlements(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES delivery_orders(id),
  currency      currency_type NOT NULL,
  collected     DECIMAL(15,2) DEFAULT 0,   -- collected on this order in this currency
  retail        DECIMAL(15,2) DEFAULT 0,   -- petty-cash retail on this order in this currency
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Per-order "is this order settled with the driver?" lookup.
CREATE INDEX IF NOT EXISTS idx_driver_settlement_orders_order
  ON driver_settlement_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlement_orders_settlement
  ON driver_settlement_orders (settlement_id);

-- Permissive dev RLS so the app's anon key can read/write the new tables
-- (same dev_anon_* pattern as the rest of the schema).
ALTER TABLE driver_settlement_currency_totals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_driver_settlement_currency_totals" ON driver_settlement_currency_totals;
CREATE POLICY "dev_anon_driver_settlement_currency_totals" ON driver_settlement_currency_totals
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE driver_settlement_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_driver_settlement_orders" ON driver_settlement_orders;
CREATE POLICY "dev_anon_driver_settlement_orders" ON driver_settlement_orders
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- A view runs with its CREATOR's rights unless told otherwise, which would
-- bypass row-level security for every anon query (Supabase flags that as
-- critical). security_invoker makes it run as the CALLER. See fix122.
ALTER VIEW public.v_daily_order_summary SET (security_invoker = on);

ALTER VIEW public.v_driver_due_to_pay SET (security_invoker = on);
