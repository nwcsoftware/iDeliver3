-- =============================================================================
-- iDeliver III — FIX: Run in Supabase SQL Editor
-- 1. Fixes ambiguous column reference in verify_login
-- 2. Adds anon RLS bypass for companies + delivery_zones
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FIX 1: verify_login — use explicit table alias to avoid ambiguous columns
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
  -- Explicit alias "ua" avoids ambiguity with RETURNS TABLE column names
  SELECT ua.* INTO v_user
  FROM user_accounts ua
  WHERE (ua.username = p_login OR ua.email = p_login OR ua.mobile = p_login)
    AND ua.status != 'inactive'
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CREDENTIALS'; END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > v_now THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED:%', EXTRACT(EPOCH FROM v_user.locked_until)::TEXT;
  END IF;

  IF v_user.status = 'suspended' THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;

  IF crypt(p_password, v_user.password_hash) != v_user.password_hash THEN
    UPDATE user_accounts ua SET
      failed_attempts = ua.failed_attempts + 1,
      locked_until    = CASE WHEN ua.failed_attempts + 1 >= 5 THEN v_now + INTERVAL '30 minutes' ELSE ua.locked_until END,
      updated_at      = v_now
    WHERE ua.id = v_user.id;
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  SELECT c.* INTO v_contact FROM contacts c WHERE c.id = v_user.contact_id;

  UPDATE user_accounts ua SET
    failed_attempts = 0,
    locked_until    = NULL,
    last_login_at   = v_now,
    updated_at      = v_now
  WHERE ua.id = v_user.id;

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

GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- FIX 2: RLS bypass for companies and delivery_zones
-- (Supabase enables RLS on all tables by default in new projects)
-- -----------------------------------------------------------------------------
ALTER TABLE companies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_anon_companies"      ON companies;
DROP POLICY IF EXISTS "dev_anon_delivery_zones" ON delivery_zones;

CREATE POLICY "dev_anon_companies"      ON companies      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "dev_anon_delivery_zones" ON delivery_zones FOR ALL TO anon USING (true) WITH CHECK (true);
