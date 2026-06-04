-- =============================================================================
-- iDeliver III — RUN THIS in Supabase SQL Editor
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Company
-- -----------------------------------------------------------------------------
INSERT INTO companies (code, name, country, currency_default)
VALUES ('ID3-MAIN', 'iDeliver III', 'Lebanon', 'USD'::currency_type)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Delivery Zones (skip if already exist for this company)
-- -----------------------------------------------------------------------------
INSERT INTO delivery_zones (company_id, name, base_fee, currency)
SELECT c.id, z.name, z.fee, 'USD'::currency_type
FROM companies c,
(VALUES
  ('Downtown',   3.00),
  ('North Zone', 5.00),
  ('South Zone', 5.00),
  ('East Zone',  7.00),
  ('West Zone',  7.00),
  ('Mountain',  10.00)
) AS z(name, fee)
WHERE c.code = 'ID3-MAIN'
  AND NOT EXISTS (
    SELECT 1 FROM delivery_zones dz
    WHERE dz.company_id = c.id AND dz.name = z.name
  );

-- -----------------------------------------------------------------------------
-- 3. Sample Drivers (skip duplicates by mobile)
-- -----------------------------------------------------------------------------
INSERT INTO contacts (company_id, contact_type, first_name, last_name, mobile, email, driver_status, driver_license, notes)
SELECT
  c.id,
  'driver'::contact_type,
  d.first_name, d.last_name, d.mobile, d.email,
  d.driver_status::driver_status,
  d.license, d.notes
FROM companies c,
(VALUES
  ('Marco', 'Silva',  '+1 555 101 2020', 'marco@example.com', 'available', 'DL-1001', 'Covers downtown zone'),
  ('Anna',  'Lee',    '+1 555 202 3030', 'anna@example.com',  'on_duty',   'DL-1002', 'Priority customer driver'),
  ('James', 'Okafor', '+1 555 303 4040', 'james@example.com', 'available', 'DL-1003', 'Handles large parcels'),
  ('Sofia', 'Reyes',  '+1 555 404 5050', 'sofia@example.com', 'available', 'DL-1004', 'Eco-friendly routes'),
  ('David', 'Chen',   '+1 555 505 6060', 'david@example.com', 'off_duty',  'DL-1005', 'Returns Monday')
) AS d(first_name, last_name, mobile, email, driver_status, license, notes)
WHERE c.code = 'ID3-MAIN'
ON CONFLICT (mobile) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. verify_login RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_login(p_login TEXT, p_password TEXT)
RETURNS TABLE (
  user_id UUID, username TEXT, email TEXT, mobile TEXT,
  role user_role, status user_status,
  company_id UUID, branch_id UUID, contact_id UUID,
  permissions JSONB, first_name TEXT, last_name TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user    user_accounts%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_user
  FROM user_accounts
  WHERE (username = p_login OR email = p_login OR mobile = p_login)
    AND status != 'inactive'
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CREDENTIALS'; END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > v_now THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED:%', EXTRACT(EPOCH FROM v_user.locked_until)::TEXT;
  END IF;

  IF v_user.status = 'suspended' THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;

  IF crypt(p_password, v_user.password_hash) != v_user.password_hash THEN
    UPDATE user_accounts SET
      failed_attempts = failed_attempts + 1,
      locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN v_now + INTERVAL '30 minutes' ELSE locked_until END,
      updated_at = v_now
    WHERE id = v_user.id;
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  SELECT * INTO v_contact FROM contacts WHERE id = v_user.contact_id;

  UPDATE user_accounts SET
    failed_attempts = 0, locked_until = NULL,
    last_login_at = v_now, updated_at = v_now
  WHERE id = v_user.id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_user.id, 'LOGIN', 'Successful login via app');

  RETURN QUERY SELECT
    v_user.id, v_user.username, v_user.email, v_user.mobile,
    v_user.role, v_user.status, v_user.company_id, v_user.branch_id,
    v_user.contact_id, v_user.permissions,
    COALESCE(v_contact.first_name, 'Admin'),
    COALESCE(v_contact.last_name,  '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. logout_user RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.logout_user(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'LOGOUT', 'User logged out');
END;
$$;
GRANT EXECUTE ON FUNCTION public.logout_user(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.logout_user(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. RLS bypass policies for development (anon key)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "dev_anon_contacts"      ON contacts;
DROP POLICY IF EXISTS "dev_anon_orders"        ON delivery_orders;
DROP POLICY IF EXISTS "dev_anon_payments"      ON payment_collections;
DROP POLICY IF EXISTS "dev_anon_user_accounts" ON user_accounts;
DROP POLICY IF EXISTS "dev_anon_audit"         ON audit_logs;

CREATE POLICY "dev_anon_contacts"      ON contacts            FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "dev_anon_orders"        ON delivery_orders     FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "dev_anon_payments"      ON payment_collections FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "dev_anon_user_accounts" ON user_accounts       FOR SELECT TO anon USING (true);
CREATE POLICY "dev_anon_audit"         ON audit_logs          FOR SELECT TO anon USING (true);

-- -----------------------------------------------------------------------------
-- 7. First admin account
--    Username: admin  |  Password: Admin@iDeliver3
--    Change immediately after first login!
-- -----------------------------------------------------------------------------
INSERT INTO user_accounts (company_id, username, email, mobile, password_hash, role, status)
SELECT
  id, 'admin', 'admin@ideliver.com', '+961 000 000 000',
  crypt('Admin@iDeliver3', gen_salt('bf', 12)),
  'super_admin'::user_role,
  'active'::user_status
FROM companies WHERE code = 'ID3-MAIN'
ON CONFLICT (username) DO NOTHING;
