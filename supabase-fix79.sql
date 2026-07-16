-- ============================================================================
-- fix79 — Reset Cashier Box transactions "as of" a date (super-admin tool)
-- ----------------------------------------------------------------------------
-- The Daily Cashier Box has no table of its own: every line is derived live from
-- CLOSED delivery_orders (dated by closed_at) and their money-movement children —
--   IN  = payment_collections
--   OUT = retail_goods_invoices + delivery_packages + order_services
-- This tool lets a super-admin permanently wipe those money movements for every
-- closed order whose closed_at falls ON OR BEFORE a chosen date, so the box (and
-- any buggy/stale amounts in it) is reset from that day back. The order shells
-- themselves are KEPT (still closed, still in the Closed Orders list) — only the
-- cashier-box-contributing rows are removed, so nothing re-floods the active list.
--
--   • preview_cashier_box_reset(p_through)        → jsonb ARRAY of the closed
--       orders that will be affected, each with id/order_number/recipient/
--       customer/closed_at and per-table counts (payments/packages/services/retail).
--   • reset_cashier_box_through(p_through, p_uid) → deletes those money rows +
--       order-linked ledger / settlement-line links, writes ONE audit summary,
--       returns jsonb counts of what was removed.
--
-- INCLUSIVE: an order is matched when it is closed AND
--   closed_at::date <= p_through  (the whole of the chosen day is included).
--
-- Mirrors delete_orders_by_ids() (fix76): SECURITY DEFINER, to_regclass guards so
-- a DB missing some tables still succeeds, granted to anon. Runs atomically.
-- Safe to run multiple times.
-- ============================================================================

-- Read-only list for the confirmation screen.
CREATE OR REPLACE FUNCTION preview_cashier_box_reset(p_through date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_json jsonb;
BEGIN
  IF p_through IS NULL THEN
    RAISE EXCEPTION 'DATE_REQUIRED';
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.closed_at, t.order_number), '[]'::jsonb)
    INTO v_json
  FROM (
    SELECT
      o.id,
      o.order_number,
      o.recipient_name,
      o.closed_at,
      COALESCE(NULLIF(TRIM(c.company_name), ''),
               NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), '—') AS customer,
      (SELECT count(*) FROM payment_collections   x WHERE x.order_id = o.id) AS payments,
      (SELECT count(*) FROM delivery_packages     x WHERE x.order_id = o.id) AS packages,
      (SELECT count(*) FROM order_services        x WHERE x.order_id = o.id) AS services,
      (SELECT count(*) FROM retail_goods_invoices x WHERE x.order_id = o.id) AS retail
    FROM delivery_orders o
    LEFT JOIN contacts c ON c.id = o.customer_id
    WHERE o.isclosed = true
      AND o.closed_at IS NOT NULL
      AND o.closed_at::date <= p_through
  ) t;

  RETURN v_json;
END;
$$;

CREATE OR REPLACE FUNCTION reset_cashier_box_through(p_through date, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  n_orders int; n_pay int; n_pkg int; n_svc int; n_retail int;
  v_desc text;
  v_company uuid;
  v_anchor uuid;
  -- Money-movement children that feed the cashier box, deleted in FK-safe order.
  -- Guarded individually so a DB missing any of them still completes.
  money_tables text[] := ARRAY[
    'retail_goods_invoices',
    'delivery_packages',
    'order_services',
    'payment_collections'
  ];
  t text;
BEGIN
  IF p_through IS NULL THEN
    RAISE EXCEPTION 'DATE_REQUIRED';
  END IF;

  -- The closed orders in scope (closed on/before the chosen date).
  SELECT array_agg(o.id) INTO v_ids
    FROM delivery_orders o
   WHERE o.isclosed = true
     AND o.closed_at IS NOT NULL
     AND o.closed_at::date <= p_through;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('orders', 0, 'payments', 0, 'packages', 0, 'services', 0, 'retail', 0);
  END IF;

  n_orders := array_length(v_ids, 1);

  -- Counts of what's being removed (all always-present tables).
  SELECT count(*) INTO n_pay    FROM payment_collections   WHERE order_id = ANY(v_ids);
  SELECT count(*) INTO n_pkg    FROM delivery_packages     WHERE order_id = ANY(v_ids);
  SELECT count(*) INTO n_svc    FROM order_services        WHERE order_id = ANY(v_ids);
  SELECT count(*) INTO n_retail FROM retail_goods_invoices WHERE order_id = ANY(v_ids);

  v_desc := format(
    'Reset Cashier Box as of %s — cleared money movements on %s closed order(s): %s payment(s), %s package(s), %s service(s), %s retail invoice(s).',
    p_through, n_orders, n_pay, n_pkg, n_svc, n_retail
  );

  -- Anchor the audit row to the first affected order (record_id is NOT NULL) and
  -- inherit its company; the full id list is kept in old_values.
  SELECT id, company_id INTO v_anchor, v_company
    FROM delivery_orders WHERE id = ANY(v_ids) LIMIT 1;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, transaction_description, old_values)
    VALUES (v_company, p_user_id, 'delivery_orders', v_anchor, 'DELETE', v_desc,
            jsonb_build_object('through', p_through, 'order_ids', to_jsonb(v_ids)));
  END IF;

  -- Remove the money-movement rows that feed the cashier box.
  FOREACH t IN ARRAY money_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE order_id = ANY($1)', t) USING v_ids;
    END IF;
  END LOOP;

  -- Order-linked ledger entries (the reimbursement/settlement lines).
  IF to_regclass('public.account_transactions') IS NOT NULL THEN
    DELETE FROM account_transactions WHERE order_id = ANY(v_ids);
  END IF;

  -- Unlink these orders from any driver settlement they were rolled into (keep
  -- the settlement headers; just drop the per-order links).
  IF to_regclass('public.driver_settlement_orders') IS NOT NULL THEN
    DELETE FROM driver_settlement_orders WHERE order_id = ANY(v_ids);
  END IF;

  -- The order shells themselves are KEPT (still closed). Only their cashier-box
  -- money movements are gone, so the box reads clean for that period.

  RETURN jsonb_build_object(
    'orders', n_orders, 'payments', n_pay, 'packages', n_pkg, 'services', n_svc, 'retail', n_retail
  );
END;
$$;

GRANT EXECUTE ON FUNCTION preview_cashier_box_reset(date)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_cashier_box_through(date, uuid)  TO anon, authenticated;
