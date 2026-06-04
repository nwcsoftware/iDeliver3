-- =============================================================================
-- fix17: User account administration + forced first-login password change
--
-- 1. verify_login now also returns must_change_password (and falls back to the
--    username for the display name when no contact is linked).
-- 2. Admin-only RPCs to create / update / (de)activate users and reset
--    passwords. New accounts and password resets force a password change on the
--    user's next login (must_change_password = TRUE).
--
-- Security model matches the rest of this app's custom auth: each admin RPC
-- takes the acting user's id (p_actor_id) and verifies that account is an
-- active admin/super_admin. (Tighten with real JWT claims before production.)
--
-- Safe to run multiple times.
-- =============================================================================


-- ── 1. verify_login: add must_change_password to the result ──────────────────
-- Return-type change requires dropping the old function first.
DROP FUNCTION IF EXISTS public.verify_login(TEXT, TEXT);

CREATE FUNCTION public.verify_login(
  p_login    TEXT,   -- username, email, or mobile
  p_password TEXT
)
RETURNS TABLE (
  user_id              UUID,
  username             TEXT,
  email                TEXT,
  mobile               TEXT,
  role                 user_role,
  status               user_status,
  company_id           UUID,
  branch_id            UUID,
  contact_id           UUID,
  permissions          JSONB,
  first_name           TEXT,
  last_name            TEXT,
  must_change_password BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user    user_accounts%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  -- Qualify with an alias: the RETURNS TABLE columns (username/email/mobile/
  -- status) are in scope as variables, so unqualified names here are ambiguous.
  SELECT * INTO v_user
  FROM user_accounts AS ua
  WHERE (ua.username = p_login OR ua.email = p_login OR ua.mobile = p_login)
    AND ua.status != 'inactive'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > v_now THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED:%', EXTRACT(EPOCH FROM v_user.locked_until)::TEXT;
  END IF;

  IF v_user.status = 'suspended' THEN
    RAISE EXCEPTION 'ACCOUNT_SUSPENDED';
  END IF;

  IF crypt(p_password, v_user.password_hash) != v_user.password_hash THEN
    UPDATE user_accounts
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE
          WHEN failed_attempts + 1 >= 5 THEN v_now + INTERVAL '30 minutes'
          ELSE locked_until
        END,
        updated_at = v_now
    WHERE id = v_user.id;

    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  SELECT * INTO v_contact FROM contacts WHERE id = v_user.contact_id;

  UPDATE user_accounts
  SET failed_attempts = 0,
      locked_until    = NULL,
      last_login_at   = v_now,
      updated_at      = v_now
  WHERE id = v_user.id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_user.id, 'LOGIN', 'Successful login via app');

  -- Cast VARCHAR columns to TEXT: RETURN QUERY is strict about matching the
  -- RETURNS TABLE types exactly (varchar(100) != text otherwise).
  RETURN QUERY SELECT
    v_user.id,
    v_user.username::TEXT,
    v_user.email::TEXT,
    v_user.mobile::TEXT,
    v_user.role,
    v_user.status,
    v_user.company_id,
    v_user.branch_id,
    v_user.contact_id,
    v_user.permissions,
    COALESCE(v_contact.first_name, v_user.username)::TEXT,
    COALESCE(v_contact.last_name,  '')::TEXT,
    COALESCE(v_user.must_change_password, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO authenticated;


-- ── Helper: assert the actor is an active admin/super_admin ──────────────────
CREATE OR REPLACE FUNCTION public._assert_admin(p_actor_id UUID)
RETURNS user_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor user_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM user_accounts WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.status != 'active'
     OR v_actor.role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  RETURN v_actor;
END;
$$;


-- ── 2a. Create a user ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_actor_id UUID,
  p_username TEXT,
  p_email    TEXT,
  p_mobile   TEXT,
  p_password TEXT,
  p_role     user_role,
  p_status   user_status DEFAULT 'active'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor user_accounts%ROWTYPE;
  v_id    UUID;
BEGIN
  v_actor := public._assert_admin(p_actor_id);

  IF p_role = 'super_admin' THEN
    RAISE EXCEPTION 'CANNOT_CREATE_SUPER_ADMIN';
  END IF;
  IF coalesce(trim(p_username), '') = '' THEN
    RAISE EXCEPTION 'USERNAME_REQUIRED';
  END IF;
  IF coalesce(p_password, '') = '' THEN
    RAISE EXCEPTION 'PASSWORD_REQUIRED';
  END IF;

  INSERT INTO user_accounts (
    company_id, username, email, mobile, password_hash,
    role, status, must_change_password, created_by
  )
  VALUES (
    v_actor.company_id,
    trim(p_username),
    NULLIF(trim(p_email), ''),
    p_mobile,
    crypt(p_password, gen_salt('bf', 12)),
    p_role,
    COALESCE(p_status, 'active'),
    TRUE,                       -- force change on first login
    p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED', 'Account created by admin');

  RETURN v_id;
END;
$$;


-- ── 2b. Update a user (username is admin-set; never self-service) ─────────────
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_actor_id UUID,
  p_user_id  UUID,
  p_username TEXT,
  p_email    TEXT,
  p_mobile   TEXT,
  p_role     user_role
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target user_accounts%ROWTYPE;
BEGIN
  PERFORM public._assert_admin(p_actor_id);

  SELECT * INTO v_target FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_target.role = 'super_admin' OR p_role = 'super_admin' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_SUPER_ADMIN';
  END IF;

  UPDATE user_accounts
  SET username   = trim(p_username),
      email      = NULLIF(trim(p_email), ''),
      mobile     = p_mobile,
      role       = p_role,
      updated_by = p_actor_id,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;


-- ── 2c. Activate / deactivate / suspend a user ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_actor_id UUID,
  p_user_id  UUID,
  p_status   user_status
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target user_accounts%ROWTYPE;
BEGIN
  PERFORM public._assert_admin(p_actor_id);

  IF p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS';
  END IF;

  SELECT * INTO v_target FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_target.role = 'super_admin' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_SUPER_ADMIN';
  END IF;

  UPDATE user_accounts
  SET status         = p_status,
      deactivated_by = CASE WHEN p_status = 'inactive' THEN p_actor_id ELSE NULL END,
      deactivated_at = CASE WHEN p_status = 'inactive' THEN NOW() ELSE NULL END,
      updated_by     = p_actor_id,
      updated_at     = NOW()
  WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'STATUS_CHANGE', 'Status set to ' || p_status::TEXT || ' by admin');
END;
$$;


-- ── 2d. Reset a user's password to an admin-specified value ──────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_actor_id     UUID,
  p_user_id      UUID,
  p_new_password TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target user_accounts%ROWTYPE;
BEGIN
  PERFORM public._assert_admin(p_actor_id);

  IF coalesce(p_new_password, '') = '' THEN
    RAISE EXCEPTION 'PASSWORD_REQUIRED';
  END IF;

  SELECT * INTO v_target FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_target.role = 'super_admin' THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_SUPER_ADMIN';
  END IF;

  UPDATE user_accounts
  SET password_hash        = crypt(p_new_password, gen_salt('bf', 12)),
      must_change_password = TRUE,     -- force change on next login
      password_changed_at  = NULL,
      failed_attempts      = 0,
      locked_until         = NULL,
      updated_by           = p_actor_id,
      updated_at           = NOW()
  WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'PASSWORD_RESET', 'Password reset by admin');
END;
$$;


GRANT EXECUTE ON FUNCTION public.admin_create_user(UUID, TEXT, TEXT, TEXT, TEXT, user_role, user_status) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, TEXT, TEXT, user_role)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(UUID, UUID, user_status)                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(UUID, UUID, TEXT)                                   TO anon, authenticated;


-- ── 3. change_password: same pgcrypto search_path fix ────────────────────────
-- Originally defined in supabase-auth.sql with SET search_path = public, which
-- can't resolve pgcrypto's gen_salt() when the extension lives in `extensions`.
CREATE OR REPLACE FUNCTION public.change_password(
  p_user_id      UUID,
  p_old_password TEXT,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash FROM user_accounts WHERE id = p_user_id;

  IF NOT FOUND OR crypt(p_old_password, v_hash) != v_hash THEN
    RETURN FALSE;
  END IF;

  UPDATE user_accounts
  SET password_hash        = crypt(p_new_password, gen_salt('bf', 12)),
      password_changed_at  = NOW(),
      must_change_password = FALSE,
      updated_at           = NOW()
  WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'PASSWORD_CHANGE', 'Password changed successfully');

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_password(UUID, TEXT, TEXT) TO anon, authenticated;
