-- ============================================================================
-- fix170 — returnables add up: On hand = Available + Empty + With customers,
--          and With customers agrees with the orders
-- ----------------------------------------------------------------------------
-- Since 2 Oct a returnable (shisha, gas, water) is an ASSET: On hand is what is
-- owned — stock in, stock out, adjustments, the empty count — and a sale or a
-- return only moves it between Available (the shelf) and the customer. That
-- adds up only if every sale and every return of the past is in the ledger,
-- and three kinds were not:
--
--   * orders closed by a screen that did not post stock (Driver Settlements
--     before 29 Sep, or a browser still running the old version): their sales
--     and returns never reached the ledger — e.g. the Arguile's two orders of
--     28 Sep, ORD-20260928-00088 and -00128;
--   * returns marked by such a screen — the 130 Gallon lines marked returned
--     on 29 Sep;
--   * the Arguile's six returns taken while it was switched to Refillable
--     (29 Sep – 1 Oct) went to the empties, and six "refill" entries were made
--     by hand to bring them back to the shelf.
--
-- WHAT THIS DOES
--   1. Every closed order of a returnable item is posted again exactly as its
--      order lines say — the same rule the application applies when an order
--      is saved (syncOrderStock). Only orders where the ledger disagrees are
--      touched.
--   2. A "refill" or "empty count" on an item that is NOT refillable is
--      removed: it can only be the hand-made fix for (1), which (1) now does.
--   3. Gallon 20 L is set to the office count of 2 Oct: 17 full, 13 empty —
--      30 owned, none with customers.
--   Every row removed is first copied to product_movements_fix170_backup.
--
-- ON HAND IS NOT MOVED by (1) or (2): sales and returns never change it. The
-- count in (3) moves full and empty in opposite directions, so it does not
-- move On hand either. Ras Arguile still needs a count — nothing here can know
-- how many it owns.
--
-- Run once. Safe to re-run: (1) finds nothing left to re-post, (2) nothing
-- left to remove, and (3) is written once.
-- ============================================================================

-- ── 0. the backup ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_movements_fix170_backup (LIKE public.product_movements INCLUDING DEFAULTS);
-- A copy for the record, not for the application: no policy, so not readable
-- through the API.
ALTER TABLE public.product_movements_fix170_backup ENABLE ROW LEVEL SECURITY;

-- Steps 1–3 run as ONE statement. The Supabase SQL editor does not keep a
-- temporary table from one statement to the next ("relation f170_lines does not
-- exist" on the first try); inside one block it does, and the working tables
-- are dropped when it finishes. If anything in it fails, none of it is applied.
DO $fix170$
BEGIN
  -- Leftovers from an earlier attempt in the same session, if any.
  DROP TABLE IF EXISTS pg_temp.f170_lines, pg_temp.f170_wanted, pg_temp.f170_have, pg_temp.f170_pairs;

  -- ── 1. what every closed order of a returnable should hold ──────────────────
  CREATE TEMP TABLE f170_lines ON COMMIT DROP AS
  SELECT oi.order_id, oi.product_id, oi.quantity, oi.unit_price, oi.currency::TEXT AS currency,
         oi.is_returned, oi.returned_at, o.order_number, o.company_id,
         COALESCE(o.closed_at, (o.scheduled_date + TIME '12:00')::TIMESTAMPTZ, o.created_at) AS closed_when,
         -- where a return goes: the application's returnMovementType()
         CASE WHEN p.is_refillable IS NOT TRUE        THEN 'returned'
              WHEN p.refillable_since IS NULL         THEN 'returned_empty'
              WHEN oi.returned_at IS NULL             THEN 'returned'
              WHEN oi.returned_at >= p.refillable_since THEN 'returned_empty'
              ELSE 'returned' END AS return_type
    FROM public.order_items oi
    JOIN public.delivery_orders o ON o.id = oi.order_id
    JOIN public.products p        ON p.id = oi.product_id
   WHERE p.is_returnable IS TRUE AND p.is_service IS NOT TRUE AND p.is_advertisement IS NOT TRUE
     AND oi.is_deleted IS NOT TRUE
     AND o.isclosed IS TRUE
     AND COALESCE(o.status::TEXT, '') NOT IN ('cancelled', 'failed');

  CREATE TEMP TABLE f170_wanted ON COMMIT DROP AS
  SELECT order_id, product_id, 'sold'::TEXT AS movement_type, SUM(quantity) AS quantity,
         MIN(unit_price) AS unit_cost, MIN(currency) AS currency, MIN(order_number) AS order_number,
         MIN(company_id::TEXT)::UUID AS company_id, MIN(closed_when) AS moved_at
    FROM f170_lines
   GROUP BY order_id, product_id
  HAVING SUM(quantity) > 0
  UNION ALL
  SELECT order_id, product_id, return_type, SUM(quantity),
         NULL, MIN(currency), MIN(order_number),
         MIN(company_id::TEXT)::UUID, COALESCE(MAX(returned_at), MIN(closed_when))
    FROM f170_lines
   WHERE is_returned IS TRUE
   GROUP BY order_id, product_id, return_type
  HAVING SUM(quantity) > 0;

  CREATE TEMP TABLE f170_have ON COMMIT DROP AS
  SELECT m.order_id, m.product_id, m.movement_type, SUM(m.quantity) AS quantity
    FROM public.product_movements m
    JOIN public.products p ON p.id = m.product_id
   WHERE p.is_returnable IS TRUE AND m.order_id IS NOT NULL
     AND m.movement_type IN ('sold', 'returned', 'returned_empty')
   GROUP BY m.order_id, m.product_id, m.movement_type;

  -- The (order, item) pairs whose ledger rows differ from what the lines say.
  CREATE TEMP TABLE f170_pairs ON COMMIT DROP AS
  SELECT DISTINCT order_id, product_id FROM (
    SELECT w.order_id, w.product_id
      FROM f170_wanted w
      LEFT JOIN f170_have h ON h.order_id = w.order_id AND h.product_id = w.product_id AND h.movement_type = w.movement_type
     WHERE h.quantity IS DISTINCT FROM w.quantity
    UNION
    SELECT h.order_id, h.product_id
      FROM f170_have h
      LEFT JOIN f170_wanted w ON w.order_id = h.order_id AND w.product_id = h.product_id AND w.movement_type = h.movement_type
     WHERE w.quantity IS NULL
  ) d;

  INSERT INTO public.product_movements_fix170_backup
  SELECT m.* FROM public.product_movements m
    JOIN f170_pairs x ON x.order_id = m.order_id AND x.product_id = m.product_id
   WHERE m.movement_type IN ('sold', 'returned', 'returned_empty')
     AND NOT EXISTS (SELECT 1 FROM public.product_movements_fix170_backup b WHERE b.id = m.id);

  DELETE FROM public.product_movements m
   USING f170_pairs x
   WHERE x.order_id = m.order_id AND x.product_id = m.product_id
     AND m.movement_type IN ('sold', 'returned', 'returned_empty');

  INSERT INTO public.product_movements
    (company_id, product_id, movement_type, quantity, unit_cost, currency, reference, notes, order_id, moved_at, created_by_name)
  SELECT w.company_id, w.product_id, w.movement_type, w.quantity, w.unit_cost,
         COALESCE(w.currency, 'USD')::currency_type, w.order_number,
         'Re-posted by fix170 as the order''s lines say', w.order_id, w.moved_at, 'fix170'
    FROM f170_wanted w
    JOIN f170_pairs x ON x.order_id = w.order_id AND x.product_id = w.product_id;

  -- ── 2. a refill or empty count on an item that is not refillable ────────────
  INSERT INTO public.product_movements_fix170_backup
  SELECT m.* FROM public.product_movements m
    JOIN public.products p ON p.id = m.product_id
   WHERE p.is_returnable IS TRUE AND p.is_refillable IS NOT TRUE
     AND m.movement_type IN ('refill', 'empty_adjust')
     AND NOT EXISTS (SELECT 1 FROM public.product_movements_fix170_backup b WHERE b.id = m.id);

  DELETE FROM public.product_movements m
   USING public.products p
   WHERE p.id = m.product_id AND p.is_returnable IS TRUE AND p.is_refillable IS NOT TRUE
     AND m.movement_type IN ('refill', 'empty_adjust');

  -- ── 3. Gallon 20 L: the office count of 2 Oct — 17 full, 13 empty ───────────
  WITH g AS (
    SELECT p.id, p.company_id, p.currency,
           COALESCE(SUM(CASE m.movement_type
                          WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity WHEN 'adjust' THEN m.quantity
                          WHEN 'refill' THEN m.quantity WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                          ELSE 0 END), 0) AS available,
           COALESCE(SUM(CASE m.movement_type
                          WHEN 'returned_empty' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                          WHEN 'refill' THEN -m.quantity ELSE 0 END), 0) AS empty
      FROM public.products p
      LEFT JOIN public.product_movements m ON m.product_id = p.id
     WHERE p.code = 'PRD-0003'
       AND NOT EXISTS (SELECT 1 FROM public.product_movements x
                        WHERE x.product_id = p.id AND x.reference = 'COUNT 02-10' AND x.created_by_name = 'fix170')
     GROUP BY p.id, p.company_id, p.currency
  )
  INSERT INTO public.product_movements
    (company_id, product_id, movement_type, quantity, currency, reference, notes, moved_at, created_by_name)
  SELECT company_id, id, 'adjust', 17 - available, currency, 'COUNT 02-10',
         'Office count 2 Oct: 30 owned — 17 full, 13 empty, none with customers', NOW(), 'fix170'
    FROM g WHERE 17 - available <> 0
  UNION ALL
  SELECT company_id, id, 'empty_adjust', 13 - empty, currency, 'COUNT 02-10',
         'Office count 2 Oct: 30 owned — 17 full, 13 empty, none with customers', NOW(), 'fix170'
    FROM g WHERE 13 - empty <> 0;
END
$fix170$;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect (as simulated on 2 Oct; a sale closed since moves Available and With
-- customers, never On hand):
--   PRD-0003 Gallon       on_hand 30   available 17   empty 13   with_customers 0   orders_say 0
--   RTN-0001 Gaz          on_hand 9    available 6    empty 3    with_customers 0   orders_say 0
--   RTN-0002 Arguile      on_hand 187  available 169  empty 0    with_customers 18  orders_say 18
--   RTN-0003 Ras Arguile  on_hand 0    available -2   empty 0    with_customers 2   orders_say 2
-- and agrees = true on every row. re_posted / backed_up say how much moved.

SELECT p.code, p.name,
       COALESCE(SUM(CASE m.movement_type WHEN 'in' THEN m.quantity WHEN 'out' THEN -m.quantity
                                         WHEN 'adjust' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                                         ELSE 0 END), 0)                                              AS on_hand,
       COALESCE(SUM(CASE m.movement_type WHEN 'in' THEN m.quantity WHEN 'returned' THEN m.quantity
                                         WHEN 'adjust' THEN m.quantity WHEN 'refill' THEN m.quantity
                                         WHEN 'sold' THEN -m.quantity WHEN 'out' THEN -m.quantity
                                         ELSE 0 END), 0)                                              AS available,
       CASE WHEN p.is_refillable THEN
         COALESCE(SUM(CASE m.movement_type WHEN 'returned_empty' THEN m.quantity WHEN 'empty_adjust' THEN m.quantity
                                           WHEN 'refill' THEN -m.quantity ELSE 0 END), 0) ELSE 0 END AS empty,
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
       (SELECT COUNT(*) FROM public.product_movements r WHERE r.product_id = p.id AND r.created_by_name = 'fix170') AS re_posted,
       (SELECT COUNT(*) FROM public.product_movements_fix170_backup b WHERE b.product_id = p.id)          AS backed_up
  FROM public.products p
  LEFT JOIN public.product_movements m ON m.product_id = p.id
 WHERE p.is_returnable IS TRUE
 GROUP BY p.id, p.code, p.name, p.is_refillable
 ORDER BY p.code;

