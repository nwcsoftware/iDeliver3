-- ============================================================================
-- fix123 — indexes for the order list (statement timeouts)
-- ----------------------------------------------------------------------------
-- The app loads orders newest-first, filtered by company and by a date window,
-- and it pages through them. With 5,000+ orders and no index matching that
-- shape, Postgres sorts the whole table for every page. Combined with the
-- embedded child rows (items, packages, invoices, payments, ads) the deeper
-- pages ran 4–6 seconds and were killed by the statement timeout:
--
--   "canceling statement due to statement timeout"
--
-- These indexes let the sort be read straight off the index instead.
--
--   delivery_orders (company_id, created_at DESC, id DESC)
--       the list's own ordering, and the keyset cursor that pages it
--   delivery_orders (company_id, scheduled_date DESC)
--       the daily/closed pages filter on the scheduled date
--   the child tables by order_id
--       every embed resolves order_id = ANY(...); without these each embed is
--       a sequential scan of the child table per page
--
-- CREATE INDEX CONCURRENTLY is not used: it cannot run inside the SQL editor's
-- transaction. These tables are small enough that the brief lock is harmless.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE INDEX IF NOT EXISTS delivery_orders_company_created_idx
  ON public.delivery_orders (company_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS delivery_orders_company_scheduled_idx
  ON public.delivery_orders (company_id, scheduled_date DESC);

-- Plain created_at too: some pages read across companies.
CREATE INDEX IF NOT EXISTS delivery_orders_created_idx
  ON public.delivery_orders (created_at DESC, id DESC);

-- The embedded child rows, all looked up by order_id.
CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS delivery_packages_order_idx
  ON public.delivery_packages (order_id);
CREATE INDEX IF NOT EXISTS order_services_order_idx
  ON public.order_services (order_id);
CREATE INDEX IF NOT EXISTS retail_goods_invoices_order_idx
  ON public.retail_goods_invoices (order_id);
CREATE INDEX IF NOT EXISTS payment_collections_order_idx
  ON public.payment_collections (order_id);
CREATE INDEX IF NOT EXISTS ads_order_idx
  ON public.ads (order_id);

-- Give the planner fresh statistics for the new indexes.
ANALYZE public.delivery_orders;
ANALYZE public.order_items;
ANALYZE public.delivery_packages;
ANALYZE public.order_services;
ANALYZE public.retail_goods_invoices;
ANALYZE public.payment_collections;
ANALYZE public.ads;

NOTIFY pgrst, 'reload schema';
