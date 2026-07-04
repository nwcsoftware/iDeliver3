-- supabase-fix77.sql
-- Make orders scheduled on 01/07/2026 appear "ready" in Driver Settlements.
--
-- 01/07/2026 (DD/MM/YYYY) = 1 July 2026. scheduled_date may carry a time
-- component, so match the whole day: >= 2026-07-01 AND < 2026-07-02.
--
-- Driver Settlements shows an order under "To Collect / Outstanding" only when it
-- is settlement-eligible (Completed + Delivered + money with the driver), NOT
-- closed, and NOT already settled. So for that day we:
--   1. put the money "with driver"      → payment_status = 'collected_by_driver',
--                                          collection_from_customer = 'Money Fully collected'
--   2. mark it Completed + Delivered     → status = 'delivered', delivery_status = 'Delivered'
--   3. re-open it                        → isclosed = false, closed_at/closed_by = NULL
--   4. drop any existing settlement line → so it reads as outstanding, not settled
-- All scoped to the same one-day window. Safe to re-run.
-- ============================================================================

-- 4. Remove settlement lines for that day's orders (they'd otherwise show as
--    already "Collected" instead of outstanding). Header rows are left as-is.
DELETE FROM public.driver_settlement_orders dso
USING public.delivery_orders o
WHERE dso.order_id = o.id
  AND o.scheduled_date IS NOT NULL
  AND o.scheduled_date >= DATE '2026-07-01'
  AND o.scheduled_date <  DATE '2026-07-02';

-- 1–3. Money-with-driver state, Completed + Delivered, and re-opened.
UPDATE public.delivery_orders
SET payment_status           = 'collected_by_driver',
    collection_from_customer = 'Money Fully collected',
    status                   = 'delivered',
    delivery_status          = 'Delivered',
    isclosed                 = false,
    closed_at                = NULL,
    closed_by                = NULL
WHERE scheduled_date IS NOT NULL
  AND scheduled_date >= DATE '2026-07-01'
  AND scheduled_date <  DATE '2026-07-02';
