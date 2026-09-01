-- =============================================================================
-- fix139 — a cancelled order is neglected everywhere
-- -----------------------------------------------------------------------------
-- The app now treats a cancelled order as an order that never happened: it earns
-- nothing, is owed nothing, no driver carries it, and no statement, settlement
-- or report mentions it. It survives in exactly one place — the Cancelled Orders
-- page — where it can be reviewed and, if it was called off in error, brought
-- back. See src/lib/orderStatus.js for the same rule on the client.
--
-- Until now cancellation worked by GUTTING the order rather than by flagging it:
-- the office cancel deletes its packages, services, invoices and payments and
-- zeroes the delivery fee, so most figures came out at zero by consequence. That
-- left real holes, and the ones below are the server's share of them:
--
--   • v_supplier_settlements  — a shop's month-end purchases and commission were
--     summed from retail_goods_invoices with no regard for whether the order
--     behind them still stood. A customer-app cancellation deletes no invoice
--     rows at all, so a cancelled order could still be billed to a shop.
--   • account_transaction_summary_view — the ledger behind Account Transactions
--     carried entries for orders that were later cancelled.
--   • v_daily_order_summary / v_driver_due_to_pay — legacy reporting views. The
--     app does not read them today, but they are granted to anon and count
--     cancelled orders into total_orders / orders_count / total_to_collect, so
--     anything reading them would disagree with every screen.
--
-- Every view keeps its exact output columns, so nothing downstream changes shape.
-- v_daily_order_summary keeps `cancelled_count` deliberately: it is the one
-- figure whose job is to report cancellations, and it is now a count of orders
-- excluded from the same row's totals rather than of orders folded into them.
--
-- NULL is not cancelled. `status <> 'cancelled'` is NULL — and therefore false —
-- for an order whose status column was never written, which would silently drop
-- those orders from every view. Each filter below spells the NULL case out.
--
-- Safe to run multiple times.
--
-- Wrapped in a transaction: this file rewrites four views that have each drifted
-- across earlier migrations, and a statement failing halfway would leave some
-- rebuilt and some not — the books disagreeing with themselves until someone
-- noticed. All four land or none do.
-- =============================================================================

BEGIN;

-- Fail early and legibly if the schema is not what these view bodies expect. A
-- raw "column rgi.paid does not exist" 500 lines in is a puzzle; this names the
-- migration that has to be applied first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'retail_goods_invoices'
      AND column_name  = 'exclude_calculation'
  ) THEN
    RAISE EXCEPTION
      'retail_goods_invoices.exclude_calculation is missing — run supabase-fix90.sql before this file.';
  END IF;
END $$;

-- ── Month-end settlement per shop ────────────────────────────────────────────
-- Invoices on a cancelled order are void: nothing was bought, so nothing is owed
-- to the shop and no commission was earned on it.
--
-- This is fix90's body — NOT fix71's. fix90 renamed retail_goods_invoices.paid
-- to exclude_calculation and narrowed commission_total to procurement invoices.
-- Anything rebuilding this view has to start from fix90, or it resurrects a
-- column that no longer exists.
CREATE OR REPLACE VIEW v_supplier_settlements AS
SELECT
  rgi.company_id                                                        AS company_id,
  rgi.contact_id                                                        AS supplier_id,
  c.code                                                                AS supplier_code,
  COALESCE(NULLIF(TRIM(c.company_name), ''),
           TRIM(CONCAT(c.first_name, ' ', c.last_name)))                AS supplier_name,
  c.credit_debit_allowed                                               AS is_credit_shop,
  date_trunc('month', COALESCE(rgi.invoice_date, o.created_at::date))::date AS month,
  rgi.currency                                                          AS currency,
  COUNT(*)                                                              AS invoice_count,
  SUM(rgi.invoice_value)                                                AS purchases_total,
  SUM(CASE WHEN COALESCE(rgi.is_procurement, FALSE)
           THEN COALESCE(rgi.commission_amount, 0) ELSE 0 END)         AS commission_total,
  SUM(CASE WHEN rgi.exclude_calculation THEN rgi.invoice_value ELSE 0 END)  AS paid_total,
  SUM(CASE WHEN rgi.exclude_calculation THEN 0 ELSE rgi.invoice_value END)  AS unpaid_total
FROM retail_goods_invoices rgi
JOIN delivery_orders o ON o.id = rgi.order_id
JOIN contacts       c ON c.id = rgi.contact_id
WHERE rgi.contact_id IS NOT NULL
  AND (o.status IS NULL OR o.status <> 'cancelled')
GROUP BY
  rgi.company_id, rgi.contact_id, c.code, c.company_name, c.first_name, c.last_name,
  c.credit_debit_allowed,
  date_trunc('month', COALESCE(rgi.invoice_date, o.created_at::date)),
  rgi.currency;

-- ── Account transactions ledger (fix39) ──────────────────────────────────────
-- A transaction that belongs to a cancelled order drops out. A transaction with
-- no order_id at all is kept — those are the ledger's own entries (driver
-- settlement reimbursements and the like), which no order cancels.
CREATE OR REPLACE VIEW account_transaction_summary_view AS
SELECT
  at.transaction_id,
  at.transaction_date,
  at.transaction_number,
  at.order_number,
  at.order_id,
  at.transaction_type,
  at.transaction_reference,
  at.transaction_description,
  at.quantity,
  at.credit_amount,
  at.debit_amount,
  at.currency_code,
  at.exchange_rate,
  at.account_number,
  at.customer_id,
  COALESCE(
    NULLIF(TRIM(c.company_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
  ) AS customer_name,
  at.company_id,
  at.branch_id,
  at.created_by
FROM account_transactions at
LEFT JOIN contacts        c ON c.id = at.customer_id
LEFT JOIN delivery_orders o ON o.id = at.order_id
WHERE at.order_id IS NULL
   OR o.id IS NULL
   OR o.status IS NULL
   OR o.status <> 'cancelled';

-- ── Legacy reporting views (schema / fix52) ──────────────────────────────────
-- Same shape as fix52 left them, with cancelled orders excluded from the totals.
CREATE OR REPLACE VIEW v_daily_order_summary AS
SELECT
  do2.company_id,
  do2.branch_id,
  DATE(do2.created_at)                        AS report_date,
  do2.driver_id,
  c.first_name || ' ' || c.last_name          AS driver_name,
  COUNT(do2.id) FILTER (
    WHERE do2.status IS NULL OR do2.status <> 'cancelled')  AS total_orders,
  SUM(do2.total_amount) FILTER (
    WHERE do2.status IS NULL OR do2.status <> 'cancelled')  AS total_value,
  COALESCE(SUM(pc.collected_usd) FILTER (
    WHERE do2.status IS NULL OR do2.status <> 'cancelled'), 0) AS collected_usd,
  COALESCE(SUM(pc.collected_lbp) FILTER (
    WHERE do2.status IS NULL OR do2.status <> 'cancelled'), 0) AS collected_lbp,
  SUM(CASE WHEN do2.status = 'delivered'  THEN 1 ELSE 0 END) AS delivered_count,
  -- Kept: this is the count whose whole job is to report cancellations. It now
  -- counts orders that are OUT of the totals above, not orders inside them.
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
  AND (do2.status IS NULL OR do2.status <> 'cancelled')
GROUP BY do2.driver_id, driver_name, driver_mobile, DATE(do2.delivered_at);

-- ── Index ────────────────────────────────────────────────────────────────────
-- Every order query in the app now carries "not cancelled". Cancelled rows are a
-- small slice of the table, so this partial index lets those queries walk only
-- the live orders instead of filtering the whole table on the way past.
CREATE INDEX IF NOT EXISTS idx_delivery_orders_live
  ON delivery_orders (company_id, scheduled_date)
  WHERE status IS NULL OR status <> 'cancelled';

-- ── Permissions ──────────────────────────────────────────────────────────────
-- CREATE OR REPLACE VIEW keeps the existing grants and options, but a view that
-- was dropped and recreated by hand would lose them. Re-stating both is cheap
-- and makes this file safe to run on any database. See fix122 for why
-- security_invoker matters.
ALTER VIEW public.v_supplier_settlements            SET (security_invoker = on);
ALTER VIEW public.account_transaction_summary_view  SET (security_invoker = on);
ALTER VIEW public.v_daily_order_summary             SET (security_invoker = on);
ALTER VIEW public.v_driver_due_to_pay               SET (security_invoker = on);

GRANT SELECT ON v_supplier_settlements           TO anon, authenticated;
GRANT SELECT ON account_transaction_summary_view TO anon, authenticated;
GRANT SELECT ON v_daily_order_summary            TO anon, authenticated;
GRANT SELECT ON v_driver_due_to_pay              TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Check afterwards — both should return 0 rows:
--
--   -- shop settlements built on a cancelled order
--   SELECT COUNT(*) FROM retail_goods_invoices rgi
--   JOIN delivery_orders o ON o.id = rgi.order_id
--   JOIN v_supplier_settlements v
--     ON v.supplier_id = rgi.contact_id AND v.currency = rgi.currency
--   WHERE o.status = 'cancelled';
--
--   -- ledger entries on a cancelled order
--   SELECT COUNT(*) FROM account_transaction_summary_view v
--   JOIN delivery_orders o ON o.id = v.order_id
--   WHERE o.status = 'cancelled';
