-- ============================================================================
-- fix103 — shop items carry MULTIPLE categories (tags), picked from the
--          admin-managed product_categories list
-- ----------------------------------------------------------------------------
-- shop_inventory.category (single free text) becomes shop_inventory.categories
-- (text[]). Suppliers tag an item with as many categories as apply, chosen from
-- product_categories — they can no longer invent new ones.
--
-- The old `category` column is KEPT and kept in sync with the first tag by the
-- app, so anything still reading it (older clients) keeps working.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.shop_inventory
  ADD COLUMN IF NOT EXISTS categories text[] DEFAULT '{}'::text[];

-- Backfill: existing single categories become a one-element tag list.
UPDATE public.shop_inventory
   SET categories = ARRAY[btrim(category)]
 WHERE COALESCE(btrim(category), '') <> ''
   AND (categories IS NULL OR cardinality(categories) = 0);

UPDATE public.shop_inventory
   SET categories = '{}'::text[]
 WHERE categories IS NULL;

-- Fast "items in any of these categories" lookups for the customer app.
CREATE INDEX IF NOT EXISTS shop_inventory_categories_idx
  ON public.shop_inventory USING GIN (categories);

NOTIFY pgrst, 'reload schema';
