-- ============================================================================
-- fix168 — Gallon 20 L: the count corrected to 18 bottles (1 available,
--          17 empty), and its refillable cut-off moved past the returns
--          marked just before it, so a re-saved order cannot undo the count
-- ----------------------------------------------------------------------------
-- THE COUNT. The office counted 18 Gallon bottles in the shop: 17 empty and 1
-- full. The hand adjustment at 13:42 (−132) brought the FULL count to 18 —
-- meant as the total — and the empties were then added on top (+17), so the
-- Inventory page read On hand 35, Available 18, Empty 17. One adjustment of
-- −17 on Available makes it 1, and On hand (available + empty) 18.
--
-- It is a fixed −17, not "set to 1": a Gallon sold after the count and before
-- this runs is a real sale and must still count. It is skipped if anybody has
-- adjusted Gallon by hand since the count (13:48), so it can never land twice.
--
-- On 28 Sep, 131 Gallon units were marked returned between about 13:25 and
-- 13:35 UTC, a few minutes before fix166 made Gallon refillable (13:37:50).
-- They were posted the old way, back on the shelf, and the office then counted
-- the shelf and corrected it by hand (−132 filled, +17 empty).
--
-- The trap left behind: the office PC's clock runs about four minutes ahead of
-- the database, and "returned at" is stamped by the PC. So 77 of those units
-- carry a time AFTER 13:37:50. The application decides where a return goes by
-- comparing that time with refillable_since, so the next time one of those
-- orders is saved it would move those returns to the empties — changing both
-- counts the office just entered.
--
-- The cut-off moves to 13:39:26, one second after the last of those stamps.
-- Every return from before fix166 then stays where it was posted; every return
-- since (stamped 13:42 or later on that PC) goes to the empties as intended.
-- Moving it changes no figure.
--
-- Run once. Safe to re-run: the adjustment is written once, and the cut-off is
-- only moved from the value fix166 set.
-- ============================================================================

-- ── 1. the count: 1 available, 17 empty, 18 in all ─────────────────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency, reference, notes, moved_at, created_by_name)
SELECT p.company_id, p.id, 'adjust', -17, p.currency, 'COUNT 28-09',
       'Counted 18 bottles: 17 empty, 1 available. The −132 of 13:42 had set 18 as FULL; 17 of those are the empties.',
       NOW(), 'fix168'
  FROM public.products p
 WHERE p.code = 'PRD-0003'
   AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.product_id = p.id
                      AND m.movement_type IN ('adjust', 'empty_adjust')
                      AND m.order_id IS NULL
                      AND m.created_at > TIMESTAMPTZ '2026-09-28 13:48:05+00');

-- ── 2. the cut-off ──────────────────────────────────────────────────────────
UPDATE public.products
   SET refillable_since = TIMESTAMPTZ '2026-09-28 13:39:26+00'
 WHERE code = 'PRD-0003'
   AND is_refillable IS TRUE
   AND refillable_since = returnable_since;   -- still exactly what fix166 set

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: available 1, empty 17, on_hand 18 (fewer available if a Gallon
-- order has closed since the count), refillable_since 2026-09-28 13:39:26,
-- and would_move 0 — no return a re-save would post differently from today.

SELECT p.code, p.name,
       to_char(p.refillable_since AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS refillable_since_utc,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity WHEN 'refill' THEN m.quantity
                              WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)      AS available,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'returned_empty' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                              WHEN 'refill' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)      AS empty,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity WHEN 'returned_empty' THEN m.quantity
                              WHEN 'empty_adjust' THEN m.quantity
                              WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)      AS on_hand,
       (SELECT COALESCE(SUM(oi.quantity), 0)
          FROM public.order_items oi
         WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS TRUE
           AND (   (oi.returned_at >= p.refillable_since
                    AND EXISTS (SELECT 1 FROM public.product_movements m
                                 WHERE m.order_id = oi.order_id AND m.product_id = p.id AND m.movement_type = 'returned'))
                OR (COALESCE(oi.returned_at < p.refillable_since, TRUE)
                    AND EXISTS (SELECT 1 FROM public.product_movements m
                                 WHERE m.order_id = oi.order_id AND m.product_id = p.id AND m.movement_type = 'returned_empty')))) AS would_move
  FROM public.products p
 WHERE p.code = 'PRD-0003';

NOTIFY pgrst, 'reload schema';
