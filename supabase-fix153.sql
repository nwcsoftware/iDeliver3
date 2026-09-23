-- ============================================================================
-- fix153 — what an item COST is recorded on the sale, not looked up afterwards
-- ----------------------------------------------------------------------------
-- order_items has always recorded what an item was sold for — unit_price,
-- discount, line_total — and never what it cost us. So profit could only ever
-- be guessed at by reading products.unit_cost, which is TODAY's cost. Change a
-- supplier's price next month and every margin in the history quietly changes
-- with it. A figure that moves when nobody touched the sale is not a figure
-- anyone can act on.
--
-- So the cost is stamped on the line, at the moment the line is written, and
-- never moves again. The same idea as fix144 stamping an order with the nature
-- of the account it billed to: record what was true when it happened.
--
-- THREE PARTS.
--
--   1. order_items.unit_cost — cost per unit, in the LINE's own currency.
--   2. A trigger that fills it from the product whenever a line is written, so
--      every path is covered: the order form, the customer app, an import, a
--      correction made by hand in the SQL editor. Nothing has to remember.
--   3. A backfill for the 1,175 lines already written.
--
-- NULL MEANS "NOT KNOWN", AND ZERO MEANS "FREE". They are not the same thing
-- and this migration never confuses them. A product with no cost entered — and
-- four of the eight have none — leaves unit_cost NULL, so a report can leave
-- the margin blank instead of printing the whole sale as profit. Today that is
-- 562 lines of 1,175 that CAN be costed; the rest wait for somebody to enter a
-- cost on the product, and only new sales will pick it up.
--
-- CURRENCY. The cost is stamped only when the product's currency matches the
-- line's, because benefit is line_total − cost × quantity and that arithmetic
-- is meaningless across currencies — there is no exchange rate anywhere in
-- this application. Exactly 12 lines are affected, all of them the advert
-- product ADD-0001, which has no cost either way.
--
-- THE BACKFILL USES TODAY'S COST, because there is nothing else to use; the
-- history was never recorded. It is a one-time approximation and it is the
-- last time this figure will be approximate. Every sale from now on carries
-- the cost that was true when it was made.
--
-- Run once in the Supabase SQL editor. Safe to re-run: the backfill only fills
-- lines that have no cost yet, so a line corrected by hand is never overwritten.
-- ============================================================================

-- ── 1. the column ───────────────────────────────────────────────────────────

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC;

COMMENT ON COLUMN public.order_items.unit_cost IS
  'What one unit cost us, in this line''s currency, as at the moment the line was written (fix153). NULL = the product had no cost entered, which is not the same as a cost of zero. Never updated afterwards: it is the cost that was true when the sale happened.';

-- ── 2. stamp it on every line written from now on ───────────────────────────
-- BEFORE INSERT, and before an UPDATE that changes which product or currency
-- the line is for. A cost passed in explicitly always wins — the trigger only
-- fills a blank.

CREATE OR REPLACE FUNCTION public.order_items_stamp_unit_cost()
RETURNS TRIGGER AS $$
DECLARE v_cost NUMERIC;
BEGIN
  IF NEW.unit_cost IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL     THEN RETURN NEW; END IF;

  SELECT p.unit_cost INTO v_cost
    FROM public.products p
   WHERE p.id = NEW.product_id
     -- ::TEXT on both sides: these are enum columns, and comparing an enum to
     -- anything else directly is the trap documented in fix68.
     AND COALESCE(p.currency::TEXT, '') = COALESCE(NEW.currency::TEXT, '')
     AND p.unit_cost IS NOT NULL
     AND p.unit_cost > 0;

  NEW.unit_cost := v_cost;   -- NULL when there is no usable cost, deliberately
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_items_stamp_unit_cost ON public.order_items;
CREATE TRIGGER trg_order_items_stamp_unit_cost
  BEFORE INSERT OR UPDATE OF product_id, currency
  ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_stamp_unit_cost();

-- ── 3. the lines already written ────────────────────────────────────────────
-- Deleted lines are stamped too. They are still history, a report may choose
-- to count them, and leaving them blank would make "no cost known" ambiguous.

UPDATE public.order_items oi
   SET unit_cost = p.unit_cost
  FROM public.products p
 WHERE p.id = oi.product_id
   AND oi.unit_cost IS NULL
   AND p.unit_cost IS NOT NULL
   AND p.unit_cost > 0
   AND COALESCE(p.currency::TEXT, '') = COALESCE(oi.currency::TEXT, '');

-- ── 4. check ────────────────────────────────────────────────────────────────
-- costed + uncosted should equal product_lines. `uncosted_because_no_product_cost`
-- is the number waiting on somebody to enter a cost against the product — it is
-- not an error, and the report leaves those margins blank rather than guessing.

SELECT
  (SELECT COUNT(*) FROM public.order_items WHERE product_id IS NOT NULL)          AS product_lines,
  (SELECT COUNT(*) FROM public.order_items WHERE unit_cost IS NOT NULL)           AS costed,
  (SELECT COUNT(*) FROM public.order_items oi
     WHERE oi.product_id IS NOT NULL AND oi.unit_cost IS NULL)                    AS uncosted,
  (SELECT COUNT(*) FROM public.order_items oi
     JOIN public.products p ON p.id = oi.product_id
    WHERE oi.unit_cost IS NULL
      AND COALESCE(p.unit_cost, 0) = 0)                                           AS uncosted_because_no_product_cost,
  (SELECT COUNT(*) FROM public.order_items oi
     JOIN public.products p ON p.id = oi.product_id
    WHERE oi.unit_cost IS NULL
      AND COALESCE(p.unit_cost, 0) > 0)                                           AS uncosted_because_currency_differs;

-- Which products still have no cost, and how much of the history they hold.
-- Enter a cost against these and every FUTURE sale is costed automatically;
-- past lines stay blank, because their cost was never known.
SELECT p.code, p.name, p.currency::TEXT AS currency, p.unit_cost,
       COUNT(oi.id) AS lines_sold
  FROM public.products p
  LEFT JOIN public.order_items oi ON oi.product_id = p.id
 WHERE COALESCE(p.unit_cost, 0) = 0
 GROUP BY p.id, p.code, p.name, p.currency, p.unit_cost
 ORDER BY lines_sold DESC;

NOTIFY pgrst, 'reload schema';
