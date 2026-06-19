-- fix60 — delete a single order completely (+ audit trail)
-- ----------------------------------------------------------------------------
-- Adds a "Delete Order" admin tool: permanently removes one order and ALL of its
-- related rows (items, services, retail invoices, packages, tracking, payments,
-- sales-invoice links, settlement lines, order-linked ledger entries), and
-- unlinks records we keep (returnable issuances, mileage logs).
--
-- Before deleting, it writes a human-readable history row to audit_logs with the
-- acting user, the company, and a transaction_description naming the order
-- number, type, customer and driver. A transaction_description column is added to
-- audit_logs so that summary reads as plain text.
--
-- Mirrors reset_all_orders() (fix56): SECURITY DEFINER, to_regclass guards so
-- databases missing some tables still succeed, granted to anon. Runs atomically.
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS transaction_description TEXT;

CREATE OR REPLACE FUNCTION delete_order_completely(p_order_number text, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    delivery_orders%ROWTYPE;
  v_customer text;
  v_driver   text;
  v_type     text;
  v_desc     text;
  n_item int := 0; n_pay int := 0; n_pkg int := 0; n_svc int := 0; n_retail int := 0;
  -- Per-order child tables, deleted in FK-safe order. Guarded individually so a
  -- DB missing any of them still completes.
  child_tables text[] := ARRAY[
    'order_items',
    'order_services',
    'retail_goods_invoices',
    'delivery_packages',
    'order_tracking',
    'payment_collections',
    'sales_invoice_orders',
    'driver_settlement_orders'
  ];
  t text;
BEGIN
  SELECT * INTO v_order FROM delivery_orders WHERE order_number = p_order_number LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Party names + order type for the history line.
  SELECT COALESCE(NULLIF(TRIM(c.company_name), ''),
                  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), '—')
    INTO v_customer FROM contacts c WHERE c.id = v_order.customer_id;
  IF v_order.driver_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
      INTO v_driver FROM contacts c WHERE c.id = v_order.driver_id;
  END IF;
  v_type := COALESCE(NULLIF(TRIM(v_order.order_type), ''), 'order');

  -- Counts of what's being removed (core tables that always exist).
  SELECT count(*) INTO n_item   FROM order_items           WHERE order_id = v_order.id;
  SELECT count(*) INTO n_pay    FROM payment_collections   WHERE order_id = v_order.id;
  SELECT count(*) INTO n_pkg    FROM delivery_packages     WHERE order_id = v_order.id;
  SELECT count(*) INTO n_svc    FROM order_services        WHERE order_id = v_order.id;
  SELECT count(*) INTO n_retail FROM retail_goods_invoices WHERE order_id = v_order.id;

  v_desc := format(
    'Deleted order %s [%s] — Customer: %s — Driver: %s. Removed %s item(s), %s payment(s), %s package(s), %s service(s), %s retail invoice(s).',
    v_order.order_number, v_type, v_customer, COALESCE(v_driver, 'unassigned'),
    n_item, n_pay, n_pkg, n_svc, n_retail
  );

  -- Audit entry first (while the order snapshot is still intact).
  INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, transaction_description, old_values)
  VALUES (v_order.company_id, p_user_id, 'delivery_orders', v_order.id, 'DELETE', v_desc, to_jsonb(v_order));

  -- Remove every child row for this order.
  FOREACH t IN ARRAY child_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE order_id = $1', t) USING v_order.id;
    END IF;
  END LOOP;

  -- Order-linked ledger entries.
  IF to_regclass('public.account_transactions') IS NOT NULL THEN
    DELETE FROM account_transactions WHERE order_id = v_order.id;
  END IF;

  -- Keep these records, just unlink them from the deleted order.
  IF to_regclass('public.returnable_issuances') IS NOT NULL THEN
    UPDATE returnable_issuances SET order_id = NULL WHERE order_id = v_order.id;
  END IF;
  IF to_regclass('public.vehicle_mileage_logs') IS NOT NULL THEN
    UPDATE vehicle_mileage_logs SET order_id = NULL WHERE order_id = v_order.id;
  END IF;

  -- Finally, the order itself.
  DELETE FROM delivery_orders WHERE id = v_order.id;

  RETURN v_desc;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_order_completely(text, uuid) TO anon, authenticated;
