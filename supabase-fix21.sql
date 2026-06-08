-- =============================================================================
-- fix21: RLS access for retail_goods_invoices (and order_external_items)
--
-- These tables have RLS enabled but no policy, so inserts from the app's anon
-- key are rejected ("new row violates row-level security policy"). Add the same
-- permissive dev policy used for the other app-written tables in
-- supabase-auth.sql. (DEVELOPMENT — tighten with real JWT claims before prod.)
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE retail_goods_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_retail_goods_invoices" ON retail_goods_invoices;
CREATE POLICY "dev_anon_retail_goods_invoices" ON retail_goods_invoices
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE order_external_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_order_external_items" ON order_external_items;
CREATE POLICY "dev_anon_order_external_items" ON order_external_items
  FOR ALL TO anon USING (true) WITH CHECK (true);
