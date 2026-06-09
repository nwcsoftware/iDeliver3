-- ============================================================================
-- fix36 — Allow writes to order_services (RLS policy)
-- ----------------------------------------------------------------------------
-- order_services has row-level security enabled but no policy for the anon
-- role, so PostgREST rejects every insert:
--   "new row violates row-level security policy for table order_services"
--
-- Adds the same dev_anon FOR ALL policy used by the other app tables
-- (contacts, delivery_orders, order_external_items, …).
-- ============================================================================

ALTER TABLE order_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_order_services" ON order_services;
CREATE POLICY "dev_anon_order_services" ON order_services
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- delivery_packages (now saved on every order, not just partners) — same policy,
-- in case it has RLS enabled without one. Harmless if RLS was already off.
ALTER TABLE delivery_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_delivery_packages" ON delivery_packages;
CREATE POLICY "dev_anon_delivery_packages" ON delivery_packages
  FOR ALL TO anon USING (true) WITH CHECK (true);
