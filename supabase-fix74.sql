-- supabase-fix74.sql
-- Sync delivery status for orders that are already Completed.
--
-- Order status is stored in delivery_orders.status as the order_status enum, where
-- "Completed" is the value 'delivered'. For every completed order, force the
-- delivery_status to 'Delivered' so the two stay consistent (matching the app,
-- which now moves delivery status to Delivered whenever the order is set Completed).
UPDATE public.delivery_orders
SET delivery_status = 'Delivered'
WHERE status = 'delivered'
  AND (delivery_status IS DISTINCT FROM 'Delivered');
