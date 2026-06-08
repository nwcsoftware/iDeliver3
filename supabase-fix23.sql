-- =============================================================================
-- fix23: Credit orders
--
-- Flags an order created via the "Credit Order" form. Such orders hide the
-- pricing sections (items / external invoices / totals / payments) and can only
-- be marked closed once a driver is assigned, delivery is Delivered and the
-- order status is Completed. The flag lets the form recognise the order again
-- when it's reopened to close it.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS is_credit_order BOOLEAN DEFAULT FALSE;
