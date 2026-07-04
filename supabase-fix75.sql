-- supabase-fix75.sql
-- Backdate each driver settlement to its first scheduled order.
--
-- The Driver Settlements → History tab shows each settlement's settlement_date,
-- which was stamped with the day the cash was collected (the day the settlement
-- was recorded). Business wants the settlement dated "as of" the EARLIEST
-- scheduled_date among the orders it settles instead.
--
-- driver_settlement_orders links each settlement to its delivery_orders; we take
-- MIN(scheduled_date) over those orders (date part only — scheduled_date may carry
-- a time component) and write it back to the header. Settlements with no order
-- lines, or whose orders all lack a scheduled_date, are left untouched.
UPDATE public.driver_daily_settlements s
SET settlement_date = agg.first_scheduled
FROM (
  SELECT dso.settlement_id,
         MIN(o.scheduled_date::date) AS first_scheduled
  FROM public.driver_settlement_orders dso
  JOIN public.delivery_orders o ON o.id = dso.order_id
  WHERE o.scheduled_date IS NOT NULL
  GROUP BY dso.settlement_id
) agg
WHERE agg.settlement_id = s.id
  AND agg.first_scheduled IS NOT NULL
  AND (s.settlement_date IS DISTINCT FROM agg.first_scheduled);
