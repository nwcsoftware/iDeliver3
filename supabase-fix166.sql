-- ============================================================================
-- fix166 — refillables: a gas cylinder or a 20 L water bottle is held FILLED
--          or EMPTY, and only a filled one is for sale
-- ----------------------------------------------------------------------------
-- Until now a returnable that came back went straight back on the shelf: sell
-- 10 of 100, 90 left; 10 come back, 100 again. True of a shisha. Not true of a
-- gas cylinder or a water bottle: it comes back EMPTY and cannot go out again
-- until it is refilled.
--
-- A product now says so itself:
--
--   products.is_refillable     TRUE: a return goes to the EMPTIES, and a refill
--                              moves empties back to filled
--   products.refillable_since  when that began. Returns before it stay where
--                              they were posted — back on the shelf — because
--                              that is what the office did with them at the time
--                              (refilled and resold, never recorded). Moving
--                              them now would take today's figure down for
--                              refills nobody can date.
--   products.returnable_since  for an item that was sold outright and is now
--                              returnable: what it sold before this was never
--                              going to be recorded back, so the Returnable
--                              Items page does not chase it as "out".
--
-- The stock ledger gains three movement types, posted by the application:
--   returned_empty   a refillable back from a customer      empty  +
--   refill           empties refilled                        filled +, empty −
--   empty_adjust     the empties counted                     empty  ±
-- "On hand" for a refillable is the FILLED count; the Inventory page shows the
-- empties beside it, with the refill and count form behind a small button.
--
-- The two products:
--   RTN-0001 Gaz                     already returnable; becomes refillable
--   PRD-0003 Gallon 20 L Tannourine  was set up as Retail, so none of its
--                                    returns was ever recorded; becomes
--                                    returnable and refillable. It keeps its
--                                    code — codes are printed on price lists.
--
-- NO STOCK FIGURE MOVES. Nothing is written to the ledger: today's on-hand
-- becomes the filled count (Gaz 8, Gallon 22) and every empty count starts at
-- 0. Neither product has ever been counted by hand, so after running this,
-- count the shelf — filled with an Adjustment, empties with "Correct empty
-- count" — and the two numbers are right from then on.
--
-- Run once. Safe to re-run: each product is changed only the first time (its
-- refillable_since is still empty), so a later change made on the Products
-- page is never undone by running this again.
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_refillable    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS refillable_since TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS returnable_since TIMESTAMPTZ;

COMMENT ON COLUMN public.products.is_refillable IS
  'A returnable that comes back EMPTY (gas cylinder, water bottle): returns go to the empties until refilled (fix166).';
COMMENT ON COLUMN public.products.refillable_since IS
  'When returns began going to the empties. Earlier returns stay as posted, back on the shelf (fix166).';
COMMENT ON COLUMN public.products.returnable_since IS
  'When an item sold outright became returnable. Lines on orders closed before it are not chased as out (fix166).';

-- ── the two refillables ─────────────────────────────────────────────────────
UPDATE public.products
   SET is_refillable = TRUE, refillable_since = NOW()
 WHERE code = 'RTN-0001' AND refillable_since IS NULL;

UPDATE public.products
   SET is_returnable = TRUE, is_retail = FALSE,
       is_refillable = TRUE, refillable_since = NOW(),
       returnable_since = COALESCE(returnable_since, NOW())
 WHERE code = 'PRD-0003' AND refillable_since IS NULL;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect two rows, both refillable:
--   RTN-0001 Gaz      filled 8   empty 0   not_chased 0
--   PRD-0003 Gallon   filled 22  empty 0   not_chased 255  (sold before today)
-- chased_out is what Returnable Items now lists as still out: Gallon's lines
-- on orders that were not yet closed when this ran.

SELECT p.code, p.name, p.is_returnable, p.is_refillable,
       to_char(p.refillable_since, 'YYYY-MM-DD HH24:MI') AS refillable_since,
       to_char(p.returnable_since, 'YYYY-MM-DD HH24:MI') AS returnable_since,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity WHEN 'refill' THEN m.quantity
                              WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)      AS filled,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'returned_empty' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                              WHEN 'refill' THEN -m.quantity
                              ELSE 0 END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0)      AS empty,
       COALESCE((SELECT SUM(oi.quantity)
                   FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
                  WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS NOT TRUE
                    AND COALESCE(o.status::TEXT, '') <> 'cancelled'
                    AND p.returnable_since IS NOT NULL AND o.isclosed IS TRUE
                    AND (o.closed_at IS NULL OR o.closed_at < p.returnable_since)), 0) AS not_chased,
       COALESCE((SELECT SUM(oi.quantity)
                   FROM public.order_items oi JOIN public.delivery_orders o ON o.id = oi.order_id
                  WHERE oi.product_id = p.id AND oi.is_deleted IS NOT TRUE AND oi.is_returned IS NOT TRUE
                    AND COALESCE(o.status::TEXT, '') <> 'cancelled'
                    AND NOT (p.returnable_since IS NOT NULL AND o.isclosed IS TRUE
                             AND (o.closed_at IS NULL OR o.closed_at < p.returnable_since))), 0) AS chased_out
  FROM public.products p
 WHERE p.is_refillable IS TRUE
 ORDER BY p.code;

NOTIFY pgrst, 'reload schema';
