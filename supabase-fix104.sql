-- ============================================================================
-- fix104 — shop_categories: the curated list of storefront categories
-- ----------------------------------------------------------------------------
-- Suppliers tag their shop items from this list (My Shop → item → Categories),
-- and the customer app filters by it. Kept SEPARATE from product_categories,
-- which belongs to the internal Products catalog.
--
-- The super admin manages the list from Settings → Shop Categories.
-- Seed values mirror src/lib/shopCategories.js (DEFAULT_SHOP_CATEGORIES) — keep
-- the two in step if you change one.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shop_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID,
  name        TEXT NOT NULL,
  sort_order  INT  DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- One entry per name (case-insensitive), so "Food" can't be added twice.
CREATE UNIQUE INDEX IF NOT EXISTS shop_categories_name_key
  ON public.shop_categories (lower(name));

-- Same dev anon policy as the rest of the app's tables.
ALTER TABLE public.shop_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_shop_categories" ON public.shop_categories;
CREATE POLICY "dev_anon_shop_categories"
  ON public.shop_categories FOR ALL TO anon USING (true) WITH CHECK (true);

-- Seed the common storefront categories. ON CONFLICT keeps re-runs harmless and
-- won't resurrect anything the super admin deleted on purpose... but note a
-- deleted default WILL come back if this file is re-run; that's what the
-- "Restore defaults" button does deliberately.
INSERT INTO public.shop_categories (name, sort_order)
VALUES
  ('Food & Beverages', 0),
  ('Restaurants & Takeaway', 1),
  ('Bakery & Sweets', 2),
  ('Fruits & Vegetables', 3),
  ('Meat & Poultry', 4),
  ('Fish & Seafood', 5),
  ('Dairy & Eggs', 6),
  ('Grocery & Supermarket', 7),
  ('Frozen Foods', 8),
  ('Snacks & Confectionery', 9),
  ('Coffee & Tea', 10),
  ('Water & Soft Drinks', 11),
  ('Health & Pharmacy', 12),
  ('Beauty & Personal Care', 13),
  ('Baby & Kids', 14),
  ('Household & Cleaning', 15),
  ('Home & Kitchen', 16),
  ('Furniture & Decor', 17),
  ('Tools & Hardware', 18),
  ('Building Materials', 19),
  ('Garden & Outdoor', 20),
  ('Electronics', 21),
  ('Mobile Phones & Accessories', 22),
  ('Computers & Accessories', 23),
  ('Gaming', 24),
  ('Fashion & Clothing', 25),
  ('Shoes & Bags', 26),
  ('Watches & Jewelry', 27),
  ('Sports & Fitness', 28),
  ('Toys & Games', 29),
  ('Books & Stationery', 30),
  ('Pet Supplies', 31),
  ('Automotive & Parts', 32),
  ('Flowers & Gifts', 33),
  ('Other', 99)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
