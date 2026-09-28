-- ============================================================================
-- fix165 — the sales that settling a driver never took off the shelf
-- ----------------------------------------------------------------------------
-- Closing an order posts its goods out of stock (syncOrderStock). The Driver
-- Settlements page closes orders too — when the cash is collected, and with its
-- own "mark closed" — and it set the flag and nothing else. From July to
-- September 98 orders were closed that way with their retail goods never
-- leaving the ledger, and Gaz's 64 orders were skipped as well. The page now
-- posts the stock; this deals with the ones already closed.
--
-- WHICH SALES REDUCE STOCK: the same rule as the application's
-- salesReduceStock() — not a service or an advert, and either marked
-- sales_reduce_stock (fix164) or ordinary retail goods.
--
-- HOW TODAY'S ON-HAND MOVES — the rule agreed with the office:
--   A sale BEFORE a product's last hand count is already in that count: the
--   shelf was counted after the goods had gone. Posting it again would take it
--   off twice, so it is balanced by an adjustment dated just before the count.
--   A sale AFTER the last count is not in any number yet, so it reduces
--   on-hand.
--   A product NEVER counted has no reliable starting figure (its on-hand is
--   whatever stock-in happened to be typed), so its history is added and
--   balanced by an opening adjustment — its on-hand does not move until
--   somebody counts it.
--
--   Expected: Box 0.5 L 26 → 20, Box 2L 17 → 14; Gallon 20 L, Gaz and Arguile
--   jardin unchanged and never counted.
--
-- A hand count = an `adjust` movement typed by a person, not one written by a
-- migration and not an opening balance.
--
-- Today's figures are backed up first. Run once. Safe to re-run.
-- ============================================================================

-- ── 1. the backup ───────────────────────────────────────────────────────────
INSERT INTO public.product_stock_snapshots (company_id, product_id, on_hand, reason)
SELECT p.company_id, p.id,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity ELSE -m.quantity END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0),
       'Before fix165 posted sales closed by driver settlements'
  FROM public.products p
 WHERE p.is_service IS NOT TRUE AND p.is_advertisement IS NOT TRUE
   AND (p.sales_reduce_stock IS TRUE
        OR (p.sales_reduce_stock IS NULL AND p.is_retail IS TRUE AND p.is_returnable IS NOT TRUE))
   AND EXISTS (
     SELECT 1 FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND o.isclosed IS TRUE
        AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
        AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                         WHERE m.order_id = o.id AND m.product_id = p.id AND m.movement_type = 'sold'))
   AND NOT EXISTS (SELECT 1 FROM public.product_stock_snapshots s
                    WHERE s.product_id = p.id AND s.reason = 'Before fix165 posted sales closed by driver settlements');

-- ── 2. the missing sales, exactly as the application posts them ─────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, unit_cost, currency,
   reference, notes, order_id, moved_at, created_by_name)
SELECT o.company_id, oi.product_id, 'sold', SUM(oi.quantity), MIN(oi.unit_price),
       MIN(oi.currency::TEXT)::currency_type, o.order_number,
       'Backfilled by fix165 — closed by a driver settlement without posting stock', o.id,
       COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at),
       'fix165'
  FROM public.order_items oi
  JOIN public.delivery_orders o ON o.id = oi.order_id
  JOIN public.products p        ON p.id = oi.product_id
 WHERE oi.is_deleted IS NOT TRUE
   AND o.isclosed IS TRUE
   AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
   AND p.is_service IS NOT TRUE AND p.is_advertisement IS NOT TRUE
   AND (p.sales_reduce_stock IS TRUE
        OR (p.sales_reduce_stock IS NULL AND p.is_retail IS TRUE AND p.is_returnable IS NOT TRUE))
   AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.movement_type = 'sold')
 GROUP BY o.company_id, oi.product_id, o.order_number, o.id, o.closed_at, o.scheduled_date, o.created_at
HAVING SUM(oi.quantity) > 0;

-- ── 3a. counted products: what the count already covered goes back ──────────
WITH counted AS (
  SELECT m.product_id, MAX(m.moved_at) AS last_count
    FROM public.product_movements m
   WHERE m.movement_type = 'adjust'
     AND COALESCE(m.created_by_name, '') NOT LIKE 'fix%'
     AND COALESCE(m.reference, '') <> 'OPENING'
   GROUP BY m.product_id
)
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency, reference, notes, moved_at, created_by_name)
SELECT p.company_id, p.id, 'adjust', SUM(b.quantity), 'USD', 'COUNT-COVERED',
       'fix165: these sales happened before the hand count on '
         || to_char(c.last_count, 'YYYY-MM-DD') || ', which already reflected them',
       c.last_count - INTERVAL '1 second', 'fix165'
  FROM public.products p
  JOIN counted c ON c.product_id = p.id
  JOIN public.product_movements b
    ON b.product_id = p.id AND b.created_by_name = 'fix165' AND b.movement_type = 'sold'
   AND b.moved_at < c.last_count
 WHERE NOT EXISTS (SELECT 1 FROM public.product_movements x
                    WHERE x.product_id = p.id AND x.reference = 'COUNT-COVERED' AND x.created_by_name = 'fix165')
 GROUP BY p.company_id, p.id, c.last_count
HAVING SUM(b.quantity) > 0;

-- ── 3b. never-counted products: history added, on-hand unchanged ────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency, reference, notes, moved_at, created_by_name)
SELECT p.company_id, p.id, 'adjust', SUM(b.quantity), 'USD', 'OPENING',
       'Opening balance written by fix165: never counted, so the backfill does not change today''s on-hand',
       (SELECT MIN(m.moved_at) FROM public.product_movements m WHERE m.product_id = p.id) - INTERVAL '1 day',
       'fix165'
  FROM public.products p
  JOIN public.product_movements b
    ON b.product_id = p.id AND b.created_by_name = 'fix165' AND b.movement_type = 'sold'
 WHERE NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.product_id = p.id AND m.movement_type = 'adjust'
                      AND COALESCE(m.created_by_name, '') NOT LIKE 'fix%'
                      AND COALESCE(m.reference, '') <> 'OPENING')
   AND NOT EXISTS (SELECT 1 FROM public.product_movements x
                    WHERE x.product_id = p.id AND x.reference = 'OPENING' AND x.created_by_name = 'fix165')
 GROUP BY p.company_id, p.id
HAVING SUM(b.quantity) > 0;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: Box 0.5 L 26 → 20, Box 2L 17 → 14; Gallon 20 L 22, Gaz 8,
-- Arguile jardin −17 unchanged. sold_added is each product's missing sales.

SELECT p.code, p.name,
       s.on_hand AS on_hand_before,
       (SELECT COALESCE(SUM(CASE m.movement_type WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                                                 WHEN 'adjust' THEN m.quantity ELSE -m.quantity END), 0)
          FROM public.product_movements m WHERE m.product_id = p.id)                  AS on_hand_after,
       (SELECT COALESCE(SUM(quantity), 0) FROM public.product_movements
         WHERE product_id = p.id AND created_by_name = 'fix165' AND movement_type = 'sold') AS sold_added,
       (SELECT to_char(MAX(m.moved_at), 'YYYY-MM-DD') FROM public.product_movements m
         WHERE m.product_id = p.id AND m.movement_type = 'adjust'
           AND COALESCE(m.created_by_name, '') NOT LIKE 'fix%'
           AND COALESCE(m.reference, '') <> 'OPENING')                                AS last_hand_count
  FROM public.products p
  JOIN public.product_stock_snapshots s
    ON s.product_id = p.id AND s.reason = 'Before fix165 posted sales closed by driver settlements'
 ORDER BY p.code;

NOTIFY pgrst, 'reload schema';
