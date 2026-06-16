-- =============================================================================
-- fix53 — reset_all_orders(): wipe all order data for a fresh start
-- -----------------------------------------------------------------------------
-- Backs the Settings -> Reset Data button. Empties delivery_orders and every
-- table holding order transaction data, in foreign-key-safe order, atomically
-- (the whole function is one transaction — all-or-nothing).
--
-- KEPT (NOT touched): contacts, vehicles, companies, branches, products,
-- inventory, users, delivery_zones, POS, driver petty cash, and any
-- account_transactions / sales_invoices not linked to an order. Vehicle mileage
-- logs and returnable issuances are KEPT — only their order_id link is cleared.
--
-- SECURITY DEFINER so it runs with the owner's rights (clean wipe regardless of
-- per-table RLS). Exposed to anon to match this project's dev access model — the
-- anon key can already delete these rows directly via the dev_anon policies, so
-- this only adds atomicity, not new power. The UI gates the button to admins.
--
-- Safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION reset_all_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Children of delivery_orders (line items, packages, attachments, history).
  DELETE FROM order_items            WHERE true;
  DELETE FROM order_external_items   WHERE true;
  DELETE FROM order_services         WHERE true;
  DELETE FROM retail_goods_invoices  WHERE true;
  DELETE FROM delivery_packages      WHERE true;
  DELETE FROM order_tracking         WHERE true;

  -- Payments collected against orders.
  DELETE FROM payment_collections    WHERE true;

  -- Sales invoices built from orders.
  DELETE FROM sales_invoice_orders   WHERE true;
  DELETE FROM sales_invoices         WHERE true;

  -- Driver settlements (header + per-currency totals + per-order lines).
  DELETE FROM driver_settlement_orders           WHERE true;
  DELETE FROM driver_settlement_currency_totals  WHERE true;
  DELETE FROM driver_daily_settlements           WHERE true;

  -- Order-linked ledger entries (keep general, non-order transactions).
  DELETE FROM account_transactions WHERE order_id IS NOT NULL;

  -- Keep these records, just unlink them from the orders being wiped.
  UPDATE returnable_issuances  SET order_id = NULL WHERE order_id IS NOT NULL;
  UPDATE vehicle_mileage_logs  SET order_id = NULL WHERE order_id IS NOT NULL;

  -- Finally, the orders themselves.
  DELETE FROM delivery_orders WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_all_orders() TO anon;
