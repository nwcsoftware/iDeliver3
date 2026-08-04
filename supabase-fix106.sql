-- ============================================================================
-- fix106 — shop items can offer colours and sizes
-- ----------------------------------------------------------------------------
-- Optional per-item variants, like any shopping app:
--   colors  jsonb  — [{ "name": "Red", "image": "<data-url|null>" }, …]
--   sizes   text[] — ['35.5','36.5',…] or ['S','M','L'], free-form labels
--
-- Both default to empty: an item with no colours/sizes behaves exactly as
-- before. Variants don't change the price — they identify what the customer
-- picked, and the choice is carried onto the order line.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.shop_inventory
  ADD COLUMN IF NOT EXISTS colors jsonb  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sizes  text[] DEFAULT '{}'::text[];

UPDATE public.shop_inventory SET colors = '[]'::jsonb  WHERE colors IS NULL;
UPDATE public.shop_inventory SET sizes  = '{}'::text[] WHERE sizes  IS NULL;

-- The customer's pick, recorded on the order line.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_color text,
  ADD COLUMN IF NOT EXISTS variant_size  text;

NOTIFY pgrst, 'reload schema';
