-- ============================================================================
-- fix167 — every Gallon 20 L marked returned, and every return of it EMPTY
-- ----------------------------------------------------------------------------
-- WHAT WENT WRONG. On 28 Sep, between about 13:25 and 13:35 UTC, 131 Gallon
-- units were marked returned on the Returnable Items page. fix166 — which
-- makes Gallon refillable, so that a return goes to the EMPTIES — ran a few
-- minutes later, at 13:37:50. So those returns were posted the old way, back
-- onto the FILLED shelf: filled read 150 instead of 22, and empty 0.
--
-- (The office PC's clock runs about four minutes ahead of the database, so 43
-- of those lines carry a "returned at" that looks later than fix166. They were
-- not; the ledger rows they made were written before it.)
--
-- WHAT THIS DOES:
--   1. Gallon's refillable_since is cleared: no return of Gallon was ever
--      recorded before it became refillable, so EVERY return of it is an empty.
--      Keeping the cut-off would put the lines returned just before it back on
--      the filled shelf the next time one of those orders is saved.
--   2. The Gallon lines still not returned — the 127 sold before returns were
--      tracked, on orders closed before 28 Sep 13:37 — are marked returned, as
--      asked. Only those: an order closed after that is left to the page, so
--      running this again never touches a new sale.
--   3. Gallon's return movements are rebuilt from the lines, the way the
--      application posts them: the 128 "returned" rows are replaced by
--      "returned_empty", and the 127 above get theirs.
--
-- EXPECTED: filled 22 (as before any of today's returns), empty 255. The 3
-- units returned on orders not yet closed post their empty when the order is
-- closed, as every return does.
--
-- 255 is every Gallon sold on a closed order since July. If fewer empties are
-- in the shop — most were surely refilled long ago — count them and enter the
-- number with "Correct empty count" on the Inventory page.
--
-- Run after fix166. Safe to re-run: the backup is written once, step 1 only
-- touches the cut-off fix166 set, step 2 skips returned lines, and step 3
-- skips orders already posted.
-- ============================================================================

-- ── 0. the backup ───────────────────────────────────────────────────────────
INSERT INTO public.product_stock_snapshots (company_id, product_id, on_hand, reason)
SELECT p.company_id, p.id,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity WHEN 'refill' THEN m.quantity
                              WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0),
       'Before fix167 moved Gallon returns to the empties'
  FROM public.products p
 WHERE p.code = 'PRD-0003'
   AND NOT EXISTS (SELECT 1 FROM public.product_stock_snapshots s
                    WHERE s.product_id = p.id AND s.reason = 'Before fix167 moved Gallon returns to the empties');

-- ── 1. every return of Gallon is an empty ───────────────────────────────────
-- fix166 set both dates to the same moment; only that cut-off is cleared.
UPDATE public.products
   SET refillable_since = NULL
 WHERE code = 'PRD-0003' AND is_refillable IS TRUE
   AND refillable_since IS NOT NULL AND refillable_since = returnable_since;

-- ── 2. the lines sold before returns were tracked, marked returned ──────────
UPDATE public.order_items oi
   SET is_returned = TRUE,
       returned_at = NOW(),
       returned_by = 'fix167 — all Gallon 20 L marked returned'
  FROM public.delivery_orders o, public.products p
 WHERE oi.order_id = o.id AND oi.product_id = p.id
   AND p.code = 'PRD-0003'
   AND oi.is_deleted IS NOT TRUE
   AND oi.is_returned IS NOT TRUE
   AND COALESCE(o.status::TEXT, '') <> 'cancelled'
   AND o.isclosed IS TRUE
   AND (o.closed_at IS NULL OR o.closed_at < p.returnable_since);

-- ── 3. the returns, rebuilt as empties ──────────────────────────────────────
DELETE FROM public.product_movements m
 USING public.products p
 WHERE m.product_id = p.id AND p.code = 'PRD-0003'
   AND m.order_id IS NOT NULL
   AND m.movement_type = 'returned';

INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency,
   reference, notes, order_id, moved_at, created_by_name)
SELECT o.company_id, oi.product_id, 'returned_empty', SUM(oi.quantity),
       MIN(oi.currency::TEXT)::currency_type, o.order_number,
       'Posted by fix167 — marked returned, back empty, waiting to be refilled', o.id,
       COALESCE(MAX(oi.returned_at), NOW()), 'fix167'
  FROM public.order_items oi
  JOIN public.delivery_orders o ON o.id = oi.order_id
  JOIN public.products p        ON p.id = oi.product_id
 WHERE p.code = 'PRD-0003'
   AND oi.is_deleted IS NOT TRUE
   AND oi.is_returned IS TRUE
   AND o.isclosed IS TRUE
   AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
   AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.order_id = o.id AND m.product_id = oi.product_id
                      AND m.movement_type = 'returned_empty')
 GROUP BY o.company_id, oi.product_id, o.order_number, o.id
HAVING SUM(oi.quantity) > 0;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: filled_before 150, filled 22, empty 255, returned_to_filled 0,
--         lines_not_returned 0, awaiting_close 3, refillable_since NULL.

SELECT p.code, p.name,
       (SELECT s.on_hand FROM public.product_stock_snapshots s
         WHERE s.product_id = p.id AND s.reason = 'Before fix167 moved Gallon returns to the empties') AS filled_before,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity WHEN 'refill' THEN m.quantity
                              WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)               AS filled,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'returned_empty' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                              WHEN 'refill' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)               AS empty,
       (SELECT COALESCE(SUM(m.quantity), 0) FROM public.product_movements m
         WHERE m.product_id = p.id AND m.movement_type = 'returned')                            AS returned_to_filled,
       (SELECT COALESCE(SUM(oi.quantity), 0)
          FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
         WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS NOT TRUE
           AND COALESCE(o.status::TEXT, '') <> 'cancelled')                                     AS lines_not_returned,
       (SELECT COALESCE(SUM(oi.quantity), 0)
          FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
         WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS TRUE
           AND o.isclosed IS NOT TRUE AND COALESCE(o.status::TEXT, '') <> 'cancelled')         AS awaiting_close,
       p.refillable_since
  FROM public.products p
 WHERE p.code = 'PRD-0003';

NOTIFY pgrst, 'reload schema';
