-- Fix: allow anon role to read/write products and product_categories

-- ── product_categories ─────────────────────────────────────────────────────
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_product_categories_select" ON product_categories;
DROP POLICY IF EXISTS "anon_product_categories_insert" ON product_categories;
DROP POLICY IF EXISTS "anon_product_categories_update" ON product_categories;

CREATE POLICY "anon_product_categories_select" ON product_categories FOR SELECT TO anon USING (true);
CREATE POLICY "anon_product_categories_insert" ON product_categories FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_product_categories_update" ON product_categories FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── products ───────────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_products_select" ON products;
DROP POLICY IF EXISTS "anon_products_insert" ON products;
DROP POLICY IF EXISTS "anon_products_update" ON products;

CREATE POLICY "anon_products_select" ON products FOR SELECT TO anon USING (true);
CREATE POLICY "anon_products_insert" ON products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_products_update" ON products FOR UPDATE TO anon USING (true) WITH CHECK (true);
