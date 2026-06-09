-- =============================================================================
-- fix30: RLS access for driver_petty_cash
--
-- driver_petty_cash has RLS enabled but no policy, so inserts/updates from the
-- app's anon key are rejected ("new row violates row-level security policy") and
-- selects silently return nothing. Add the same permissive dev policy used for
-- the other app-written tables (see supabase-auth.sql / fix21 / fix22).
-- (DEVELOPMENT — tighten with real JWT claims before production.)
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE driver_petty_cash ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_driver_petty_cash" ON driver_petty_cash;
CREATE POLICY "dev_anon_driver_petty_cash" ON driver_petty_cash
  FOR ALL TO anon USING (true) WITH CHECK (true);
