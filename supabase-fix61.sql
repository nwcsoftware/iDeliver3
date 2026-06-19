-- fix61 — order numbering: collision-safe sequence
-- ----------------------------------------------------------------------------
-- The original generate_order_number() trigger built the daily sequence from
-- COUNT(*) of today's orders + 1. That breaks as soon as an order is deleted (or
-- otherwise removed): the count drops, so the "next" number reuses one that still
-- exists, and the insert fails with
--     duplicate key value violates unique constraint "delivery_orders_order_number_key"
--
-- This rewrites the function to:
--   1. take the HIGHEST existing suffix for today's prefix and add 1 (robust to
--      gaps left by deletions), then
--   2. loop and bump the number while it's already taken, so a generated number
--      is guaranteed free before it's assigned.
--
-- Trigger wiring is unchanged (BEFORE INSERT, only when order_number IS NULL).
-- Safe to run multiple times.
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  prefix    TEXT;
  seq_val   INTEGER;
  order_num TEXT;
BEGIN
  prefix := 'ORD-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-';

  -- Highest numeric suffix already used for today's prefix, + 1. Only well-formed
  -- numeric suffixes are considered; deletions leave gaps but never lower the max.
  SELECT COALESCE(MAX(SUBSTRING(order_number FROM LENGTH(prefix) + 1)::INTEGER), 0) + 1
  INTO seq_val
  FROM delivery_orders
  WHERE order_number LIKE prefix || '%'
    AND SUBSTRING(order_number FROM LENGTH(prefix) + 1) ~ '^\d+$';

  order_num := prefix || LPAD(seq_val::TEXT, 5, '0');

  -- Defensive: if that number somehow exists (gaps / concurrent inserts), keep
  -- bumping until a free one is found.
  WHILE EXISTS (SELECT 1 FROM delivery_orders WHERE order_number = order_num) LOOP
    seq_val   := seq_val + 1;
    order_num := prefix || LPAD(seq_val::TEXT, 5, '0');
  END LOOP;

  NEW.order_number := order_num;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
