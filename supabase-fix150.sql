-- =============================================================================
-- fix150 — what was sold finally leaves the shelf
-- -----------------------------------------------------------------------------
-- product_movements has carried five movement types since fix126 — in, sold,
-- out, returned, adjust — and in practice only ever held the first. Nothing in
-- the application wrote to it except the Stock in / Stock out form on the
-- Inventory page, so 1,100 order lines went out of the door and moved no stock
-- at all: "Sold" read zero for every product, "out" read zero, and on-hand was
-- only ever what somebody had typed by hand. The product form said "stock moves
-- in when purchased and out when sold"; it did not.
--
-- The application now posts a `sold` movement when an order is CLOSED, and
-- withdraws it if the order is reopened, edited or cancelled. This migration
-- deals with the 1,100 that already happened.
--
-- THREE STEPS, IN THIS ORDER, AND THE FIRST ONE IS THE IMPORTANT ONE.
--
--   1. BACK UP WHAT THE STOCK SAYS TODAY. Before a single row is written, the
--      current on-hand per product is copied into product_stock_snapshots. This
--      is the number the office has been working from, and once history is
--      poured into the ledger it can no longer be recovered by arithmetic.
--
--   2. BACKFILL the sales. One `sold` movement per product per closed order,
--      dated when the order was closed. Cancelled and failed orders move
--      nothing — they never happened. Deleted order lines move nothing — they
--      were taken back off the order.
--
--   3. PUT THE OPENING BALANCE BACK. Backfilling sales without the matching
--      purchases would drive every product hundreds of units negative, which is
--      not a truer picture, only a different wrong one. So each product gets one
--      `adjust` dated before its first sale, sized so that the on-hand AFTER the
--      backfill equals what it was BEFORE it. Today's figure does not move; the
--      ledger simply gains the history behind it.
--
-- So nothing on screen changes the moment this runs — and that is the point.
-- What changes is that a real count can now be compared against a real ledger.
-- Where the shelf disagrees with the number, post an `adjust`; the snapshot
-- table is there to show what it was before any of this.
--
-- SCOPE. Retail products only. A service and an advert are not goods. A
-- RETURNABLE has its own cycle — out, then back when the customer returns it —
-- handled on the Returnable Items page, so returnables are deliberately left
-- alone here rather than being half-counted.
--
-- Run once in the Supabase SQL editor, AFTER fix126. Safe to re-run: the
-- backfill skips orders already posted, and the opening balance is written once
-- per product.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. THE BACKUP
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_stock_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID,
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  on_hand      NUMERIC NOT NULL,
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason       TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.product_stock_snapshots IS
  'What the stock ledger said at a moment in time. Written before fix150 poured order history into product_movements, so the figure the office had been working from is recoverable afterwards.';

ALTER TABLE public.product_stock_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_product_stock_snapshots" ON public.product_stock_snapshots;
CREATE POLICY "dev_anon_product_stock_snapshots" ON public.product_stock_snapshots
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Taken once. A second run must not overwrite the original picture with one
-- that already contains the backfill.
INSERT INTO public.product_stock_snapshots (company_id, product_id, on_hand, reason)
SELECT p.company_id, p.id,
       COALESCE((
         SELECT SUM(CASE m.movement_type
                      WHEN 'in' THEN m.quantity
                      WHEN 'returned' THEN m.quantity
                      WHEN 'adjust' THEN m.quantity
                      ELSE -m.quantity END)
           FROM public.product_movements m WHERE m.product_id = p.id
       ), 0),
       'Before fix150 backfilled sold movements from closed orders'
  FROM public.products p
 WHERE NOT EXISTS (
   SELECT 1 FROM public.product_stock_snapshots s
    WHERE s.product_id = p.id
      AND s.reason = 'Before fix150 backfilled sold movements from closed orders');

-- -----------------------------------------------------------------------------
-- 2. THE BACKFILL
-- -----------------------------------------------------------------------------
-- One movement per product per order, matching what syncOrderStock() writes, so
-- a backfilled row and one posted by the application are indistinguishable — and
-- so re-closing an old order finds its movement already there and changes
-- nothing.

INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, unit_cost, currency,
   reference, notes, order_id, moved_at, created_by_name)
SELECT
  o.company_id,
  oi.product_id,
  'sold',
  SUM(oi.quantity),
  MIN(oi.unit_price),
  MIN(oi.currency::TEXT)::currency_type,
  o.order_number,
  'Backfilled by fix150 from a closed order',
  o.id,
  COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at),
  'fix150'
FROM public.order_items oi
JOIN public.delivery_orders o ON o.id = oi.order_id
JOIN public.products p       ON p.id = oi.product_id
WHERE oi.is_deleted IS NOT TRUE
  AND o.isclosed IS TRUE
  AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
  AND p.is_retail IS TRUE
  AND p.is_returnable IS NOT TRUE
  AND p.is_service IS NOT TRUE
  AND p.is_advertisement IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.product_movements m
     WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.movement_type = 'sold')
GROUP BY o.company_id, oi.product_id, o.order_number, o.id, o.closed_at, o.scheduled_date, o.created_at
HAVING SUM(oi.quantity) > 0;

-- -----------------------------------------------------------------------------
-- 3. THE OPENING BALANCE
-- -----------------------------------------------------------------------------
-- Exactly enough to put each product back where it was, dated a day before its
-- earliest movement so it reads as what it is: what was on the shelf when the
-- ledger begins.

INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency,
   reference, notes, moved_at, created_by_name)
SELECT
  p.company_id,
  p.id,
  'adjust',
  s.on_hand - COALESCE((
    SELECT SUM(CASE m.movement_type
                 WHEN 'in' THEN m.quantity
                 WHEN 'returned' THEN m.quantity
                 WHEN 'adjust' THEN m.quantity
                 ELSE -m.quantity END)
      FROM public.product_movements m WHERE m.product_id = p.id
  ), 0),
  'USD',
  'OPENING',
  'Opening balance written by fix150 so the backfill did not change today''s on-hand',
  COALESCE((SELECT MIN(m.moved_at) FROM public.product_movements m WHERE m.product_id = p.id)
           - INTERVAL '1 day', NOW()),
  'fix150'
FROM public.products p
JOIN public.product_stock_snapshots s
  ON s.product_id = p.id
 AND s.reason = 'Before fix150 backfilled sold movements from closed orders'
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_movements m
   WHERE m.product_id = p.id AND m.reference = 'OPENING' AND m.created_by_name = 'fix150')
  AND s.on_hand <> COALESCE((
    SELECT SUM(CASE m.movement_type
                 WHEN 'in' THEN m.quantity
                 WHEN 'returned' THEN m.quantity
                 WHEN 'adjust' THEN m.quantity
                 ELSE -m.quantity END)
      FROM public.product_movements m WHERE m.product_id = p.id
  ), 0);

-- -----------------------------------------------------------------------------
-- 4. CHECK — the figure that must not have moved
-- -----------------------------------------------------------------------------
-- on_hand_matches_snapshot should equal products_snapshotted. If it does not,
-- a product's on-hand has moved, and the snapshot says by how much.

WITH now_on_hand AS (
  SELECT p.id,
         COALESCE(SUM(CASE m.movement_type
                        WHEN 'in' THEN m.quantity
                        WHEN 'returned' THEN m.quantity
                        WHEN 'adjust' THEN m.quantity
                        ELSE -m.quantity END), 0) AS on_hand
    FROM public.products p
    LEFT JOIN public.product_movements m ON m.product_id = p.id
   GROUP BY p.id
)
SELECT
  (SELECT COUNT(*) FROM public.product_stock_snapshots
    WHERE reason = 'Before fix150 backfilled sold movements from closed orders') AS products_snapshotted,
  (SELECT COUNT(*) FROM public.product_movements WHERE movement_type = 'sold')   AS sold_movements,
  (SELECT COUNT(*) FROM public.product_movements WHERE movement_type = 'in')     AS in_movements,
  (SELECT COUNT(*) FROM public.product_movements WHERE reference = 'OPENING')    AS opening_balances,
  (SELECT COUNT(*) FROM now_on_hand n
     JOIN public.product_stock_snapshots s ON s.product_id = n.id
    WHERE s.reason = 'Before fix150 backfilled sold movements from closed orders'
      AND n.on_hand = s.on_hand)                                                 AS on_hand_matches_snapshot;
