-- Fix: add extensions schema to search_path so crypt() is visible

CREATE OR REPLACE FUNCTION public.verify_login(p_login TEXT, p_password TEXT)
RETURNS TABLE (
  user_id UUID, username TEXT, email TEXT, mobile TEXT,
  role user_role, status user_status,
  company_id UUID, branch_id UUID, contact_id UUID,
  permissions JSONB, first_name TEXT, last_name TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user    user_accounts%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
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

  IF extensions.crypt(p_password, v_user.password_hash) != v_user.password_hash THEN
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

-- Also fix change_password for the same reason
CREATE OR REPLACE FUNCTION public.change_password(p_user_id UUID, p_old_password TEXT, p_new_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_hash TEXT;
BEGIN
  SELECT ua.password_hash INTO v_hash FROM user_accounts ua WHERE ua.id = p_user_id;
  IF NOT FOUND OR extensions.crypt(p_old_password, v_hash) != v_hash THEN RETURN FALSE; END IF;

  UPDATE user_accounts SET
    password_hash        = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
    password_changed_at  = NOW(),
    must_change_password = FALSE,
    updated_at           = NOW()
  WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'PASSWORD_CHANGE', 'Password changed successfully');
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_password(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.change_password(UUID, TEXT, TEXT) TO authenticated;

-- Re-hash the admin password using extensions.crypt so it's stored correctly
UPDATE user_accounts SET
  password_hash = extensions.crypt('Admin@iDeliver3', extensions.gen_salt('bf', 12))
WHERE username = 'admin';
