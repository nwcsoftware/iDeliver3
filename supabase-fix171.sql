-- ============================================================================
-- fix171 — an item made returnable later: what it sold BEFORE counts as back
-- ----------------------------------------------------------------------------
-- PRD-0007 Arguile jardin was sold as a retail item until 2 Oct, when it was
-- made Returnable and its stock entered: 21 owned. Its 429 sales from 2 Jul to
-- 30 Sep were never marked returned — nobody tracked returns for it then — so
-- the Inventory page read them as still with customers: On hand 21, Available
-- −408, With customers 429. They are not out; they came back long ago.
--
-- WHAT THIS DOES, for every returnable item that has a returnable_since (the
-- moment it was made returnable):
--   1. its order lines on orders closed BEFORE that moment, never marked
--      returned, are marked returned — dated when their order closed, signed
--      "fix171 — sold before returns were tracked";
--   2. their returns are posted to the stock ledger, the way the application
--      posts a return (syncOrderStock).
-- Sales made AFTER an item became returnable are not touched: from then on
-- returns are tracked one by one, as they happen.
--
-- Today that is PRD-0007 only. Expected: On hand 21, Available 21, With
-- customers 0, and the orders agreeing. ON HAND IS NOT MOVED — a return never
-- changes what is owned.
--
-- Run once. Safe to re-run: what is marked once is not found again. Any ledger
-- row it replaces is first copied to product_movements_fix171_backup.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_movements_fix171_backup (LIKE public.product_movements INCLUDING DEFAULTS);
ALTER TABLE public.product_movements_fix171_backup ENABLE ROW LEVEL SECURITY;

-- One block: the SQL editor does not keep temporary tables between statements.
DO $fix171$
BEGIN
  DROP TABLE IF EXISTS pg_temp.f171_pairs;

  -- ── 1. the lines sold before the item became returnable ──────────────────
  -- (Created first and filled after: a statement that changes rows may feed an
  -- INSERT, but not a CREATE TABLE … AS.)
  CREATE TEMP TABLE f171_pairs (order_id UUID, product_id UUID) ON COMMIT DROP;
  WITH marked AS (
    UPDATE public.order_items oi
       SET is_returned = TRUE,
           returned_at = COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at),
           returned_by = 'fix171 — sold before returns were tracked'
      FROM public.delivery_orders o, public.products p
     WHERE oi.order_id = o.id AND oi.product_id = p.id
       AND p.is_returnable IS TRUE AND p.returnable_since IS NOT NULL
       AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS NOT TRUE
       AND o.isclosed IS TRUE AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
       AND COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at) < p.returnable_since
    RETURNING oi.order_id, oi.product_id
  )
  INSERT INTO f171_pairs SELECT DISTINCT order_id, product_id FROM marked;

  -- ── 2. their returns, posted as the application posts them ────────────────
  INSERT INTO public.product_movements_fix171_backup
  SELECT m.* FROM public.product_movements m
    JOIN f171_pairs x ON x.order_id = m.order_id AND x.product_id = m.product_id
   WHERE m.movement_type IN ('returned', 'returned_empty')
     AND NOT EXISTS (SELECT 1 FROM public.product_movements_fix171_backup b WHERE b.id = m.id);

  DELETE FROM public.product_movements m
   USING f171_pairs x
   WHERE x.order_id = m.order_id AND x.product_id = m.product_id
     AND m.movement_type IN ('returned', 'returned_empty');

  INSERT INTO public.product_movements
    (company_id, product_id, movement_type, quantity, currency, reference, notes, order_id, moved_at, created_by_name)
  SELECT MIN(o.company_id::TEXT)::UUID, oi.product_id,
         -- where a return goes: the application's returnMovementType()
         CASE WHEN p.is_refillable IS NOT TRUE          THEN 'returned'
              WHEN p.refillable_since IS NULL           THEN 'returned_empty'
              WHEN oi.returned_at IS NULL               THEN 'returned'
              WHEN oi.returned_at >= p.refillable_since THEN 'returned_empty'
              ELSE 'returned' END,
         SUM(oi.quantity), MIN(oi.currency::TEXT)::currency_type, MIN(o.order_number),
         'Posted by fix171 — sold before returns were tracked, counted as back', oi.order_id,
         MAX(oi.returned_at), 'fix171'
    FROM f171_pairs x
    JOIN public.order_items oi     ON oi.order_id = x.order_id AND oi.product_id = x.product_id
    JOIN public.delivery_orders o  ON o.id = oi.order_id
    JOIN public.products p         ON p.id = oi.product_id
   WHERE oi.is_deleted IS NOT TRUE AND oi.is_returned IS TRUE
   GROUP BY oi.order_id, oi.product_id,
            CASE WHEN p.is_refillable IS NOT TRUE          THEN 'returned'
                 WHEN p.refillable_since IS NULL           THEN 'returned_empty'
                 WHEN oi.returned_at IS NULL               THEN 'returned'
                 WHEN oi.returned_at >= p.refillable_since THEN 'returned_empty'
                 ELSE 'returned' END
  HAVING SUM(oi.quantity) > 0;
END
$fix171$;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect PRD-0007: on_hand 21, available 21, with_customers 0, orders_say 0,
-- agrees true, marked_by_fix171 429.

SELECT p.code, p.name,
       COALESCE(SUM(CASE m.movement_type WHEN 'in' THEN m.quantity WHEN 'out' THEN -m.quantity
                                         WHEN 'adjust' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                                         ELSE 0 END), 0)                                              AS on_hand,
       COALESCE(SUM(CASE m.movement_type WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                                         WHEN 'adjust' THEN m.quantity WHEN 'refill' THEN m.quantity
                                         WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                                         ELSE 0 END), 0)                                              AS available,
       COALESCE(SUM(CASE m.movement_type WHEN 'sold' THEN m.quantity WHEN 'returned' THEN -m.quantity
                                         WHEN 'returned_empty' THEN -m.quantity ELSE 0 END), 0)       AS with_customers,
       (SELECT COALESCE(SUM(oi.quantity), 0)
          FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
         WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS NOT TRUE
           AND o.isclosed IS TRUE AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed'))   AS orders_say,
       COALESCE(SUM(CASE m.movement_type WHEN 'sold' THEN m.quantity WHEN 'returned' THEN -m.quantity
                                         WHEN 'returned_empty' THEN -m.quantity ELSE 0 END), 0)
         = (SELECT COALESCE(SUM(oi.quantity), 0)
              FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS NOT TRUE
               AND o.isclosed IS TRUE AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed'))  AS agrees,
       (SELECT COALESCE(SUM(oi.quantity), 0) FROM public.order_items oi
         WHERE oi.product_id = p.id AND oi.returned_by = 'fix171 — sold before returns were tracked')     AS marked_by_fix171
  FROM public.products p
  LEFT JOIN public.product_movements m ON m.product_id = p.id
 WHERE p.code = 'PRD-0007'
 GROUP BY p.id, p.code, p.name;
