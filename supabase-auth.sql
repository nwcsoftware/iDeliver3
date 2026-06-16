-- =============================================================================
-- iDeliver III - CUSTOM AUTH SETUP
-- Run this in the Supabase SQL Editor AFTER the main schema.
-- =============================================================================

-- =============================================================================
-- 1. verify_login RPC
--    Called by the Electron app with username/email/mobile + plain password.
--    Uses pgcrypto crypt() to verify the stored hash.
--    Returns the full user profile on success, raises an exception on failure.
-- =============================================================================

DROP FUNCTION IF EXISTS public.verify_login(TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.verify_login(
  p_login    TEXT,   -- username, email, or mobile
  p_password TEXT
)
RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  email       TEXT,
  mobile      TEXT,
  role        user_role,
  status      user_status,
  company_id  UUID,
  branch_id   UUID,
  contact_id  UUID,
  permissions JSONB,
  first_name  TEXT,
  last_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    user_accounts%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  -- Find user by username, email, or mobile
  SELECT * INTO v_user
  FROM user_accounts
  WHERE (
    username = p_login OR
    email    = p_login OR
    mobile   = p_login
  )
  AND status != 'inactive'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  -- Account locked?
  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > v_now THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED:%', EXTRACT(EPOCH FROM v_user.locked_until)::TEXT;
  END IF;

  -- Account suspended?
  IF v_user.status = 'suspended' THEN
    RAISE EXCEPTION 'ACCOUNT_SUSPENDED';
  END IF;

  -- Verify password using pgcrypto
  IF crypt(p_password, v_user.password_hash) != v_user.password_hash THEN
    -- Increment failed attempts; lock after 5
    UPDATE user_accounts
    SET
      failed_attempts = failed_attempts + 1,
      locked_until = CASE
        WHEN failed_attempts + 1 >= 5
          THEN v_now + INTERVAL '30 minutes'
        ELSE locked_until
      END,
      updated_at = v_now
    WHERE id = v_user.id;

    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  -- Get linked contact (for first/last name)
  SELECT * INTO v_contact FROM contacts WHERE id = v_user.contact_id;

  -- Successful login: reset lockout, stamp last_login_at
  UPDATE user_accounts
  SET
    failed_attempts = 0,
    locked_until    = NULL,
    last_login_at   = v_now,
    updated_at      = v_now
  WHERE id = v_user.id;

  -- Audit log entry
  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_user.id, 'LOGIN', 'Successful login via app');

  RETURN QUERY SELECT
    v_user.id,
    v_user.username,
    v_user.email,
    v_user.mobile,
    v_user.role,
    v_user.status,
    v_user.company_id,
    v_user.branch_id,
    v_user.contact_id,
    v_user.permissions,
    COALESCE(v_contact.first_name, 'Admin'),
    COALESCE(v_contact.last_name,  '');
END;
$$;

-- Allow unauthenticated (anon) callers so the login screen can call it
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO authenticated;


-- =============================================================================
-- 2. logout_user RPC
--    Stamps user_logbook; session clearing is done client-side.
-- =============================================================================

DROP FUNCTION IF EXISTS public.logout_user(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.logout_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'LOGOUT', 'User logged out');
END;
$$;

GRANT EXECUTE ON FUNCTION public.logout_user(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.logout_user(UUID) TO authenticated;


-- =============================================================================
-- 3. change_password RPC
-- =============================================================================

DROP FUNCTION IF EXISTS public.change_password(UUID, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.change_password(
  p_user_id     UUID,
  p_old_password TEXT,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash FROM user_accounts WHERE id = p_user_id;

  IF NOT FOUND OR crypt(p_old_password, v_hash) != v_hash THEN
    RETURN FALSE;
  END IF;

  UPDATE user_accounts
  SET
    password_hash       = crypt(p_new_password, gen_salt('bf', 12)),
    password_changed_at = NOW(),
    must_change_password = FALSE,
    updated_at          = NOW()
  WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'PASSWORD_CHANGE', 'Password changed successfully');

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_password(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.change_password(UUID, TEXT, TEXT) TO authenticated;


-- =============================================================================
-- 4. RLS bypass policies for anon key (DEVELOPMENT — tighten before production)
--    Since we use custom auth (not Supabase Auth), auth.uid() is always NULL.
--    These policies let the anon key read/write all tables during development.
--    TODO: Replace with role-based JWT claims before going to production.
-- =============================================================================

-- Contacts
DROP POLICY IF EXISTS "dev_anon_contacts" ON contacts;
CREATE POLICY "dev_anon_contacts" ON contacts FOR ALL TO anon USING (true) WITH CHECK (true);

-- Delivery orders
DROP POLICY IF EXISTS "dev_anon_orders" ON delivery_orders;
CREATE POLICY "dev_anon_orders" ON delivery_orders FOR ALL TO anon USING (true) WITH CHECK (true);

-- Payment collections
DROP POLICY IF EXISTS "dev_anon_payments" ON payment_collections;
CREATE POLICY "dev_anon_payments" ON payment_collections FOR ALL TO anon USING (true) WITH CHECK (true);

-- User accounts (read-only for anon — login RPC handles writes)
DROP POLICY IF EXISTS "dev_anon_user_accounts" ON user_accounts;
CREATE POLICY "dev_anon_user_accounts" ON user_accounts FOR SELECT TO anon USING (true);

-- Audit logs (read-only)
DROP POLICY IF EXISTS "dev_anon_audit" ON audit_logs;
CREATE POLICY "dev_anon_audit" ON audit_logs FOR SELECT TO anon USING (true);


-- =============================================================================
-- 5. FIRST ADMIN USER
--    Default credentials:
--      Username : admin
--      Password : Admin@iDeliver3
--    !! CHANGE IMMEDIATELY AFTER FIRST LOGIN !!
-- =============================================================================

INSERT INTO user_accounts (
  company_id,
  username,
  email,
  mobile,
  password_hash,
  role,
  status
)
SELECT
  id,
  'admin',
  'admin@ideliver.com',
  '+961 000 000 000',
  crypt('Admin@iDeliver3', gen_salt('bf', 12)),
  'super_admin'::user_role,
  'active'::user_status
FROM companies
WHERE code = 'ID3-MAIN'
ON CONFLICT (username) DO NOTHING;
