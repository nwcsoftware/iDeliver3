-- =============================================================================
-- fix56 — reset_all_orders(): tolerate tables that don't exist
-- -----------------------------------------------------------------------------
-- fix53 hard-coded DELETEs against every order-related table. On databases that
-- never got some of those migrations (e.g. order_external_items), the whole
-- function aborts with:  relation "order_external_items" does not exist  — and
-- nothing gets cleared because the function is one transaction.
--
-- This recreates the function so each table is touched only if it actually
-- exists (checked via to_regclass). Missing tables are silently skipped; the
-- reset still runs atomically over whatever tables are present.
--
-- SECURITY DEFINER / anon grant / behaviour are otherwise identical to fix53.
-- Safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION reset_all_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Child / transaction tables to fully empty, in foreign-key-safe order.
  wipe_tables text[] := ARRAY[
    'order_items',
    'order_services',
    'retail_goods_invoices',
    'delivery_packages',
    'order_tracking',
    'payment_collections',
    'sales_invoice_orders',
    'sales_invoices',
    'driver_settlement_orders',
    'driver_settlement_currency_totals',
    'driver_daily_settlements'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY wipe_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE true', t);
    END IF;
  END LOOP;

  -- Order-linked ledger entries (keep general, non-order transactions).
  IF to_regclass('public.account_transactions') IS NOT NULL THEN
    DELETE FROM account_transactions WHERE order_id IS NOT NULL;
  END IF;

  -- Keep these records, just unlink them from the orders being wiped.
  IF to_regclass('public.returnable_issuances') IS NOT NULL THEN
    UPDATE returnable_issuances SET order_id = NULL WHERE order_id IS NOT NULL;
  END IF;
  IF to_regclass('public.vehicle_mileage_logs') IS NOT NULL THEN
    UPDATE vehicle_mileage_logs SET order_id = NULL WHERE order_id IS NOT NULL;
  END IF;

  -- Finally, the orders themselves.
  IF to_regclass('public.delivery_orders') IS NOT NULL THEN
    DELETE FROM delivery_orders WHERE true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_all_orders() TO anon;
