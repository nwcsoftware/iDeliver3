-- ============================================================================
-- fix165 — every sale leaves the shelf and every return comes back:
--          the orders that driver settlements closed, and every returnable
-- ----------------------------------------------------------------------------
-- TWO GAPS IN THE STOCK LEDGER, closed together.
--
-- 1. DRIVER SETTLEMENTS. Closing an order posts its goods out of stock
--    (syncOrderStock) — but only from the Orders page. The Driver Settlements
--    page closes orders too, when the cash is collected, and it set the flag and
--    nothing else. 98 orders from July to September never took their goods off
--    the shelf. The page now posts; this posts the ones already closed.
--
-- 2. RETURNABLES. A returnable is stock like anything else: it goes out when
--    the order closes (−1) and comes back when it is marked returned (+1). Ten
--    shishas on hand, one goes out: nine; it comes back: ten. Until now
--    returnables were skipped when an order closed, and a return touched no
--    stock at all. The application now does both; this posts the history —
--    551 Arguile issued / 533 returned, 44 / 41 Ras Arguile, 71 / 71 Gaz — from
--    the returns recorded on the order lines (order_items.is_returned, what the
--    Returnable Items page writes).
--
-- Gaz is put back to Returnable (it was switched to Retail on 28 Sep), and the
-- fix164 "sales reduce stock" flag is cleared: every returnable now goes out
-- and comes back, so a per-product switch is not needed.
--
-- HOW TODAY'S ON-HAND MOVES — the rule agreed with the office:
--   A movement BEFORE a product's last hand count is already in that count, so
--   it is balanced by an adjustment dated just before the count.
--   A movement AFTER the last count is not in any number yet, so it counts.
--   A product NEVER counted has no reliable starting figure: its history is
--   added and balanced by an opening adjustment, so its on-hand does not move
--   until somebody counts it.
--
--   Expected: Box 0.5 L 26 → 20, Box 2L 17 → 14; every other product unchanged
--   (Gallon 20 L, Arguile jardin, Gaz, Arguile and Ras Arguile have never been
--   counted).
--
-- A hand count = an `adjust` typed by a person — not one a migration wrote, not
-- an opening balance. Today's figures are backed up first.
--
-- Run once. Safe to re-run.
-- ============================================================================

-- ── 0. Gaz is a returnable; the per-product switch is retired ───────────────
UPDATE public.products SET is_returnable = TRUE, is_retail = FALSE
 WHERE code = 'RTN-0001' AND (is_returnable IS NOT TRUE OR is_retail IS TRUE);
UPDATE public.products SET sales_reduce_stock = NULL WHERE sales_reduce_stock IS NOT NULL;

-- The rule — goods move stock, retail and returnable; services and adverts
-- never do (the application's salesReduceStock) — is written out below where
-- it is used:  NOT service AND NOT advert AND (retail OR returnable).

-- ── 1. the backup ───────────────────────────────────────────────────────────
INSERT INTO public.product_stock_snapshots (company_id, product_id, on_hand, reason)
SELECT p.company_id, p.id,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity ELSE -m.quantity END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0),
       'Before fix165 posted missing sales and returns'
  FROM public.products p
 WHERE (p.is_service IS NOT TRUE AND p.is_advertisement IS NOT TRUE AND (p.is_retail IS TRUE OR p.is_returnable IS TRUE))
   AND EXISTS (SELECT 1 FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND o.isclosed IS TRUE
                  AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed'))
   AND NOT EXISTS (SELECT 1 FROM public.product_stock_snapshots s
                    WHERE s.product_id = p.id AND s.reason = 'Before fix165 posted missing sales and returns');

-- ── 2a. the missing sales, as the application posts them ────────────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, unit_cost, currency,
   reference, notes, order_id, moved_at, created_by_name)
SELECT o.company_id, oi.product_id, 'sold', SUM(oi.quantity), MIN(oi.unit_price),
       MIN(oi.currency::TEXT)::currency_type, o.order_number,
       'Backfilled by fix165 — the order closed without posting its stock', o.id,
       COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at),
       'fix165'
  FROM public.order_items oi
  JOIN public.delivery_orders o ON o.id = oi.order_id
  JOIN public.products p        ON p.id = oi.product_id
 WHERE oi.is_deleted IS NOT TRUE
   AND o.isclosed IS TRUE
   AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
   AND (p.is_service IS NOT TRUE AND p.is_advertisement IS NOT TRUE AND (p.is_retail IS TRUE OR p.is_returnable IS TRUE))
   AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.movement_type = 'sold')
 GROUP BY o.company_id, oi.product_id, o.order_number, o.id, o.closed_at, o.scheduled_date, o.created_at
HAVING SUM(oi.quantity) > 0;

-- ── 2b. the returns — returnables marked returned on their order line ───────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency,
   reference, notes, order_id, moved_at, created_by_name)
SELECT o.company_id, oi.product_id, 'returned', SUM(oi.quantity),
       MIN(oi.currency::TEXT)::currency_type, o.order_number,
       'Backfilled by fix165 — marked returned on the Returnable Items page', o.id,
       COALESCE(MAX(oi.returned_at), o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at),
       'fix165'
  FROM public.order_items oi
  JOIN public.delivery_orders o ON o.id = oi.order_id
  JOIN public.products p        ON p.id = oi.product_id
 WHERE oi.is_deleted IS NOT TRUE
   AND oi.is_returned IS TRUE
   AND o.isclosed IS TRUE
   AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
   AND (p.is_service IS NOT TRUE AND p.is_advertisement IS NOT TRUE AND (p.is_retail IS TRUE OR p.is_returnable IS TRUE)) AND p.is_returnable IS TRUE
   AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.movement_type = 'returned')
 GROUP BY o.company_id, oi.product_id, o.order_number, o.id, o.closed_at, o.scheduled_date, o.created_at
HAVING SUM(oi.quantity) > 0;

-- ── 3a. counted products: what the count already covered is balanced ────────
-- The balancing entry is the opposite of what fix165 posted before the count:
-- sales before it come back (+), returns before it go out (−).
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
SELECT p.company_id, p.id, 'adjust',
       SUM(CASE b.movement_type WHEN 'sold' THEN b.quantity ELSE -b.quantity END),
       'USD', 'COUNT-COVERED',
       'fix165: these happened before the hand count on '
         || to_char(c.last_count, 'YYYY-MM-DD') || ', which already reflected them',
       c.last_count - INTERVAL '1 second', 'fix165'
  FROM public.products p
  JOIN counted c ON c.product_id = p.id
  JOIN public.product_movements b
    ON b.product_id = p.id AND b.created_by_name = 'fix165'
   AND b.movement_type IN ('sold', 'returned') AND b.moved_at < c.last_count
 WHERE NOT EXISTS (SELECT 1 FROM public.product_movements x
                    WHERE x.product_id = p.id AND x.reference = 'COUNT-COVERED' AND x.created_by_name = 'fix165')
 GROUP BY p.company_id, p.id, c.last_count
HAVING SUM(CASE b.movement_type WHEN 'sold' THEN b.quantity ELSE -b.quantity END) <> 0;

-- ── 3b. never-counted products: history added, on-hand unchanged ────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency, reference, notes, moved_at, created_by_name)
SELECT p.company_id, p.id, 'adjust',
       SUM(CASE b.movement_type WHEN 'sold' THEN b.quantity ELSE -b.quantity END),
       'USD', 'OPENING',
       'Opening balance written by fix165: never counted, so the backfill does not change today''s on-hand',
       (SELECT MIN(m.moved_at) FROM public.product_movements m WHERE m.product_id = p.id) - INTERVAL '1 day',
       'fix165'
  FROM public.products p
  JOIN public.product_movements b
    ON b.product_id = p.id AND b.created_by_name = 'fix165' AND b.movement_type IN ('sold', 'returned')
 WHERE NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.product_id = p.id AND m.movement_type = 'adjust'
                      AND COALESCE(m.created_by_name, '') NOT LIKE 'fix%'
                      AND COALESCE(m.reference, '') <> 'OPENING')
   AND NOT EXISTS (SELECT 1 FROM public.product_movements x
                    WHERE x.product_id = p.id AND x.reference = 'OPENING' AND x.created_by_name = 'fix165')
 GROUP BY p.company_id, p.id
HAVING SUM(CASE b.movement_type WHEN 'sold' THEN b.quantity ELSE -b.quantity END) <> 0;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect Box 0.5 L 26 → 20 and Box 2L 17 → 14; every other row unchanged.
-- sold_added / returned_added are what the ledger was missing.

SELECT p.code, p.name,
       s.on_hand AS on_hand_before,
       (SELECT COALESCE(SUM(CASE m.movement_type WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                                                 WHEN 'adjust' THEN m.quantity ELSE -m.quantity END), 0)
          FROM public.product_movements m WHERE m.product_id = p.id)                        AS on_hand_after,
       (SELECT COALESCE(SUM(quantity), 0) FROM public.product_movements
         WHERE product_id = p.id AND created_by_name = 'fix165' AND movement_type = 'sold')     AS sold_added,
       (SELECT COALESCE(SUM(quantity), 0) FROM public.product_movements
         WHERE product_id = p.id AND created_by_name = 'fix165' AND movement_type = 'returned') AS returned_added,
       COALESCE((SELECT to_char(MAX(m.moved_at), 'YYYY-MM-DD') FROM public.product_movements m
                  WHERE m.product_id = p.id AND m.movement_type = 'adjust'
                    AND COALESCE(m.created_by_name, '') NOT LIKE 'fix%'
                    AND COALESCE(m.reference, '') <> 'OPENING'), 'never')                   AS last_hand_count
  FROM public.products p
  JOIN public.product_stock_snapshots s
    ON s.product_id = p.id AND s.reason = 'Before fix165 posted missing sales and returns'
 ORDER BY p.code;

NOTIFY pgrst, 'reload schema';
