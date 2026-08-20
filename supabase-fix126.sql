-- ============================================================================
-- fix126 — stock for 3asari3's own products
-- ----------------------------------------------------------------------------
-- Suppliers have had a stock ledger since fix113; the house catalog never did.
-- `products` carried reorder_level and reorder_quantity — thresholds for WHEN
-- to reorder — but nothing recorded how many were actually held, so the office
-- had a price list rather than an inventory.
--
-- product_movements is that ledger, deliberately the same shape as
-- shop_inventory_movements so both sides read alike:
--
--     on hand = Σ in − Σ out − Σ sold + Σ returned ± adjustments
--
--   in       goods received (a purchase, a transfer in)
--   out      goods leaving that are not a sale (damage, transfer, own use)
--   sold     handed to a customer on an order
--   returned came back from a customer
--   adjust   a count correction; the quantity may be negative
--
-- Nothing is ever edited or deleted in normal use: a mistake is corrected by
-- another movement, so the history stays a true account of what happened.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID,
  product_id       UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type    TEXT NOT NULL DEFAULT 'in',   -- in | out | sold | returned | adjust
  quantity         NUMERIC NOT NULL DEFAULT 0,   -- negative only for 'adjust'
  unit_cost        NUMERIC,                      -- what it cost us, for stock value
  currency         TEXT DEFAULT 'USD',
  reference        TEXT,                         -- invoice no., order no., count sheet…
  notes            TEXT,
  order_id         UUID,                         -- set when the movement came from an order
  created_by       UUID,
  created_by_name  TEXT,
  moved_at         TIMESTAMPTZ DEFAULT NOW(),    -- the movement's own date, not the row's
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- The two questions asked of this table: "what is on hand for every product?"
-- and "what happened to this one product?"
CREATE INDEX IF NOT EXISTS product_movements_product_idx
  ON public.product_movements (product_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS product_movements_company_idx
  ON public.product_movements (company_id, moved_at DESC);

-- Same dev anon policy as the rest of the app's tables.
ALTER TABLE public.product_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_product_movements" ON public.product_movements;
CREATE POLICY "dev_anon_product_movements"
  ON public.product_movements FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
