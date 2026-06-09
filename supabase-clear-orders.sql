-- ============================================================================
-- Clear all ORDER data for a fresh start
-- ----------------------------------------------------------------------------
-- Empties delivery orders and every table that holds order transaction data,
-- in foreign-key-safe order, inside one transaction (all-or-nothing).
--
-- KEPT (NOT touched): contacts, vehicles, companies, branches, products,
-- inventory, users, delivery_zones, POS transactions, driver petty cash, etc.
-- Vehicle mileage logs are KEPT — only their order_id link is cleared.
--
-- All primary keys are UUIDs, so there are no sequences to reset.
--
-- ⚠️  DESTRUCTIVE & IRREVERSIBLE. Take a backup/snapshot first if unsure.
-- ============================================================================

BEGIN;

-- 1. Order line items & attachments (children of delivery_orders) ─────────────
DELETE FROM order_items;
DELETE FROM order_external_items;
DELETE FROM order_services;
DELETE FROM retail_goods_invoices;

-- 2. Order status history ─────────────────────────────────────────────────────
DELETE FROM order_tracking;

-- 3. Payments collected against orders ────────────────────────────────────────
DELETE FROM payment_collections;

-- 4. Sales invoices built from orders ─────────────────────────────────────────
--    (Remove these two lines if you want to keep manually-created invoices.)
DELETE FROM sales_invoice_orders;
DELETE FROM sales_invoices;

-- 5. Driver daily settlements (aggregate order collections) ───────────────────
DELETE FROM driver_daily_settlements;

-- 6. Unlink mileage logs from orders, but keep the mileage records ────────────
UPDATE vehicle_mileage_logs SET order_id = NULL WHERE order_id IS NOT NULL;

-- 7. Finally, the orders themselves ───────────────────────────────────────────
DELETE FROM delivery_orders;

COMMIT;

-- Verify everything is empty (should all return 0):
SELECT
  (SELECT count(*) FROM delivery_orders)        AS delivery_orders,
  (SELECT count(*) FROM order_items)            AS order_items,
  (SELECT count(*) FROM order_external_items)   AS order_external_items,
  (SELECT count(*) FROM order_services)         AS order_services,
  (SELECT count(*) FROM retail_goods_invoices)  AS retail_goods_invoices,
  (SELECT count(*) FROM order_tracking)         AS order_tracking,
  (SELECT count(*) FROM payment_collections)    AS payment_collections,
  (SELECT count(*) FROM sales_invoice_orders)   AS sales_invoice_orders,
  (SELECT count(*) FROM sales_invoices)         AS sales_invoices,
  (SELECT count(*) FROM driver_daily_settlements) AS driver_daily_settlements;
