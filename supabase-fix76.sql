-- fix76 — bulk-delete orders in a scheduled-date range (+ audit trail)
-- ----------------------------------------------------------------------------
-- Adds a super-admin "Delete Orders by Date" tool: lists every order whose
-- scheduled_date falls within an inclusive [from, to] range so the admin can
-- tick/untick individual orders, then permanently removes the chosen ones and
-- ALL of their related rows (items, services, retail invoices, packages,
-- tracking, payments, sales-invoice links, settlement lines, order-linked ledger
-- entries), and unlinks records we keep (returnable issuances, mileage logs).
--
--   • preview_orders_delete_range(from, to) → jsonb ARRAY of orders, each with
--       id, order_number, recipient_name, customer, status, scheduled_date and
--       its own per-table counts (items/services/packages/retail/payments).
--   • delete_orders_by_ids(ids, uid)        → deletes exactly the given orders,
--       writes one audit summary row, returns jsonb counts of what was removed.
--
-- INCLUSIVE RANGE: an order is listed when scheduled_date >= p_from AND
-- scheduled_date < (p_to + 1 day), i.e. the whole of both the start and end days
-- are included (times on the end date are not clipped).
--
-- Mirrors delete_order_completely() (fix60): SECURITY DEFINER, to_regclass guards
-- so a DB missing some tables still succeeds, granted to anon. Runs atomically.
-- Safe to run multiple times.
-- ============================================================================

-- A superseded range-delete from an earlier draft of this fix — removed in favour
-- of the id-list delete so the admin can deselect individual orders.
DROP FUNCTION IF EXISTS delete_orders_in_date_range(date, date, uuid);

-- Read-only list for the confirmation screen. Only the always-present child
-- tables are counted (same set the single-order Delete tool shows).
CREATE OR REPLACE FUNCTION preview_orders_delete_range(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_json jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'DATE_RANGE_REQUIRED';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'DATE_RANGE_INVALID';
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.scheduled_date, t.order_number), '[]'::jsonb)
    INTO v_json
  FROM (
    SELECT
      o.id,
      o.order_number,
      o.recipient_name,
      o.status,
      o.scheduled_date,
      COALESCE(NULLIF(TRIM(c.company_name), ''),
               NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), '—') AS customer,
      (SELECT count(*) FROM order_items           x WHERE x.order_id = o.id) AS items,
      (SELECT count(*) FROM order_services        x WHERE x.order_id = o.id) AS services,
      (SELECT count(*) FROM delivery_packages     x WHERE x.order_id = o.id) AS packages,
      (SELECT count(*) FROM retail_goods_invoices x WHERE x.order_id = o.id) AS retail,
      (SELECT count(*) FROM payment_collections   x WHERE x.order_id = o.id) AS payments
    FROM delivery_orders o
    LEFT JOIN contacts c ON c.id = o.customer_id
    WHERE o.scheduled_date IS NOT NULL
      AND o.scheduled_date >= p_from
      AND o.scheduled_date < (p_to + 1)          -- inclusive of the entire end day
  ) t;

  RETURN v_json;
END;
$$;

CREATE OR REPLACE FUNCTION delete_orders_by_ids(p_ids uuid[], p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_orders int; n_item int; n_pay int; n_pkg int; n_svc int; n_retail int;
  v_desc text;
  v_company uuid;
  v_anchor uuid;
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
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_ORDERS_SELECTED';
  END IF;

  -- Only count/act on ids that really exist (ignore anything already gone).
  SELECT count(*) INTO n_orders FROM delivery_orders WHERE id = ANY(p_ids);
  IF n_orders = 0 THEN
    RETURN jsonb_build_object('orders', 0, 'items', 0, 'payments', 0,
                              'packages', 0, 'services', 0, 'retail', 0);
  END IF;

  -- Counts of what's being removed (core tables that always exist).
  SELECT count(*) INTO n_item   FROM order_items           WHERE order_id = ANY(p_ids);
  SELECT count(*) INTO n_pay    FROM payment_collections   WHERE order_id = ANY(p_ids);
  SELECT count(*) INTO n_pkg    FROM delivery_packages     WHERE order_id = ANY(p_ids);
  SELECT count(*) INTO n_svc    FROM order_services        WHERE order_id = ANY(p_ids);
  SELECT count(*) INTO n_retail FROM retail_goods_invoices WHERE order_id = ANY(p_ids);

  v_desc := format(
    'Bulk-deleted %s selected order(s) — Removed %s item(s), %s payment(s), %s package(s), %s service(s), %s retail invoice(s).',
    n_orders, n_item, n_pay, n_pkg, n_svc, n_retail
  );

  -- Anchor the audit row to the first existing selected order (record_id is
  -- NOT NULL) and inherit its company; the full id list is kept in old_values.
  SELECT id, company_id INTO v_anchor, v_company
    FROM delivery_orders WHERE id = ANY(p_ids) LIMIT 1;

  -- One audit summary row for the whole batch (before anything is removed).
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, transaction_description, old_values)
    VALUES (v_company, p_user_id, 'delivery_orders', v_anchor, 'DELETE', v_desc,
            jsonb_build_object('order_ids', to_jsonb(p_ids)));
  END IF;

  -- Remove every child row for the selected orders.
  FOREACH t IN ARRAY child_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE order_id = ANY($1)', t) USING p_ids;
    END IF;
  END LOOP;

  -- Order-linked ledger entries.
  IF to_regclass('public.account_transactions') IS NOT NULL THEN
    DELETE FROM account_transactions WHERE order_id = ANY(p_ids);
  END IF;

  -- Keep these records, just unlink them from the deleted orders.
  IF to_regclass('public.returnable_issuances') IS NOT NULL THEN
    UPDATE returnable_issuances SET order_id = NULL WHERE order_id = ANY(p_ids);
  END IF;
  IF to_regclass('public.vehicle_mileage_logs') IS NOT NULL THEN
    UPDATE vehicle_mileage_logs SET order_id = NULL WHERE order_id = ANY(p_ids);
  END IF;

  -- Finally, the orders themselves.
  DELETE FROM delivery_orders WHERE id = ANY(p_ids);

  RETURN jsonb_build_object(
    'orders', n_orders, 'items', n_item, 'payments', n_pay,
    'packages', n_pkg, 'services', n_svc, 'retail', n_retail
  );
END;
$$;

GRANT EXECUTE ON FUNCTION preview_orders_delete_range(date, date)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_orders_by_ids(uuid[], uuid)       TO anon, authenticated;
