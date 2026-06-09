-- =============================================================================
-- fix31: Driver ↔ vehicle assignments (history) + app RLS for vehicles
--
-- A driver can be assigned multiple vehicles over time. driver_vehicle_assignments
-- records each assignment (driver, vehicle, start date) so it can be shown both on
-- the driver form and as the assigned-driver history on a vehicle's profile.
--
-- Also adds the permissive dev RLS policies so the app's anon key can read/write
-- vehicles and the new assignments table (same pattern as the other app tables).
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id),
  driver_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date    DATE,
  notes       TEXT,
  created_by  UUID REFERENCES user_accounts(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dva_driver  ON driver_vehicle_assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_dva_vehicle ON driver_vehicle_assignments(vehicle_id);

-- Dev RLS (DEVELOPMENT — tighten with real JWT claims before production).
ALTER TABLE driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_driver_vehicle_assignments" ON driver_vehicle_assignments;
CREATE POLICY "dev_anon_driver_vehicle_assignments" ON driver_vehicle_assignments
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_vehicles" ON vehicles;
CREATE POLICY "dev_anon_vehicles" ON vehicles
  FOR ALL TO anon USING (true) WITH CHECK (true);
