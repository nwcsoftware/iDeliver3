-- ============================================================================
-- fix164 — a returnable whose CONTENTS are sold leaves the shelf when sold
-- ----------------------------------------------------------------------------
-- The stock ledger skips every returnable when an order closes (fix150), on the
-- reasoning that a returnable goes out and comes back. That is true of a
-- shisha, which is lent and returned. It is not true of gas: the customer keeps
-- the gas, and only the empty bottle comes back. So Gaz sold 71 units on closed
-- orders while the Inventory page showed Sold 0 and an on-hand that never fell.
--
-- A product now says so itself:
--
--   products.sales_reduce_stock   TRUE   sales post a `sold` movement even though
--                                        it is returnable (the contents are
--                                        consumed; the container's return is
--                                        still tracked on Returnable Items)
--                                 FALSE  sales never move stock
--                                 NULL   the old rule: retail goods move,
--                                        returnables, services and adverts don't
--
-- Gaz (RTN-0001) is set TRUE. Arguile and Ras Arguile stay as they are — they
-- come back.
--
-- AND ITS HISTORY, THE WAY fix150 DID IT FOR EVERY OTHER PRODUCT:
--   1. back up today's on-hand for these products;
--   2. post one `sold` movement per closed order, dated when the order closed;
--   3. add one opening balance, dated before the first sale, so today's on-hand
--      does not move. The ledger gains the history; the number the office works
--      from stays put until somebody counts the shelf and posts an adjustment.
--   Without step 3 Gaz would read 8 − 71 = −63: most of what was sold was never
--   entered as stock in.
--
-- Run once. Safe to re-run: the snapshot and the opening balance are written
-- once per product, and the backfill skips orders already posted.
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sales_reduce_stock BOOLEAN;
COMMENT ON COLUMN public.products.sales_reduce_stock IS
  'TRUE: sales reduce stock even for a returnable (its contents are consumed, e.g. gas). FALSE: never. NULL: retail goods only (fix164).';

UPDATE public.products SET sales_reduce_stock = TRUE
 WHERE code = 'RTN-0001' AND sales_reduce_stock IS NULL;

-- ── 1. the backup ───────────────────────────────────────────────────────────
INSERT INTO public.product_stock_snapshots (company_id, product_id, on_hand, reason)
SELECT p.company_id, p.id,
       COALESCE((SELECT SUM(CASE m.movement_type
                              WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                              WHEN 'adjust' THEN m.quantity ELSE -m.quantity END)
                   FROM public.product_movements m WHERE m.product_id = p.id), 0),
       'Before fix164 backfilled sales of a consumed returnable'
  FROM public.products p
 WHERE p.sales_reduce_stock IS TRUE AND p.is_returnable IS TRUE
   AND NOT EXISTS (SELECT 1 FROM public.product_stock_snapshots s
                    WHERE s.product_id = p.id
                      AND s.reason = 'Before fix164 backfilled sales of a consumed returnable');

-- ── 2. the backfill — exactly what the application posts ────────────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, unit_cost, currency,
   reference, notes, order_id, moved_at, created_by_name)
SELECT o.company_id, oi.product_id, 'sold', SUM(oi.quantity), MIN(oi.unit_price),
       MIN(oi.currency::TEXT)::currency_type, o.order_number,
       'Backfilled by fix164 from a closed order', o.id,
       COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at),
       'fix164'
  FROM public.order_items oi
  JOIN public.delivery_orders o ON o.id = oi.order_id
  JOIN public.products p        ON p.id = oi.product_id
 WHERE oi.is_deleted IS NOT TRUE
   AND o.isclosed IS TRUE
   AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed')
   AND p.sales_reduce_stock IS TRUE AND p.is_returnable IS TRUE
   AND NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.movement_type = 'sold')
 GROUP BY o.company_id, oi.product_id, o.order_number, o.id, o.closed_at, o.scheduled_date, o.created_at
HAVING SUM(oi.quantity) > 0;

-- ── 3. the opening balance — today's on-hand does not move ──────────────────
INSERT INTO public.product_movements
  (company_id, product_id, movement_type, quantity, currency, reference, notes, moved_at, created_by_name)
SELECT p.company_id, p.id, 'adjust',
       s.on_hand - COALESCE((SELECT SUM(CASE m.movement_type
                                          WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                                          WHEN 'adjust' THEN m.quantity ELSE -m.quantity END)
                               FROM public.product_movements m WHERE m.product_id = p.id), 0),
       'USD', 'OPENING',
       'Opening balance written by fix164 so the backfill did not change today''s on-hand',
       COALESCE((SELECT MIN(m.moved_at) FROM public.product_movements m WHERE m.product_id = p.id)
                - INTERVAL '1 day', NOW()),
       'fix164'
  FROM public.products p
  JOIN public.product_stock_snapshots s
    ON s.product_id = p.id AND s.reason = 'Before fix164 backfilled sales of a consumed returnable'
 WHERE NOT EXISTS (SELECT 1 FROM public.product_movements m
                    WHERE m.product_id = p.id AND m.reference = 'OPENING' AND m.created_by_name = 'fix164')
   AND s.on_hand <> COALESCE((SELECT SUM(CASE m.movement_type
                                           WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                                           WHEN 'adjust' THEN m.quantity ELSE -m.quantity END)
                                FROM public.product_movements m WHERE m.product_id = p.id), 0);

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect for Gaz: sold_units = 71 (every closed-order unit), on_hand = 8 (as
-- before), on_hand_unchanged = true.

SELECT p.code, p.name,
       (SELECT COALESCE(SUM(quantity), 0) FROM public.product_movements
         WHERE product_id = p.id AND movement_type = 'sold')                        AS sold_units,
       (SELECT COALESCE(SUM(CASE movement_type WHEN 'in' THEN quantity WHEN 'returned' THEN quantity
                                               WHEN 'adjust' THEN quantity ELSE -quantity END), 0)
          FROM public.product_movements WHERE product_id = p.id)                    AS on_hand,
       (SELECT s.on_hand FROM public.product_stock_snapshots s
         WHERE s.product_id = p.id AND s.reason = 'Before fix164 backfilled sales of a consumed returnable')
         = (SELECT COALESCE(SUM(CASE movement_type WHEN 'in' THEN quantity WHEN 'returned' THEN quantity
                                                   WHEN 'adjust' THEN quantity ELSE -quantity END), 0)
              FROM public.product_movements WHERE product_id = p.id)                AS on_hand_unchanged
  FROM public.products p
 WHERE p.sales_reduce_stock IS TRUE AND p.is_returnable IS TRUE;

NOTIFY pgrst, 'reload schema';
