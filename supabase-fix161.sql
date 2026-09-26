-- ============================================================================
-- fix161 — a Senior Call Center user may add a partner's portal login, and
--          reset its password, but change nothing else
-- ----------------------------------------------------------------------------
-- fix160 let an administrator create a partner / supplier login from the
-- contact's profile and, afterwards, only reset its password. This extends the
-- same two actions — and only those two — to the Senior Call Center rank:
--
--   admin_create_party_login   super admin, admin, senior call center
--   admin_reset_password       super admin: any login
--                              admin, senior call center: partner and supplier
--                              logins only, always forcing a change
--
-- Editing, moving, activating, deactivating and deleting a login stay the
-- super admin's (fix160). The Call Center rank still has none of it.
--
-- A separate assertion rather than widening _assert_admin: _assert_admin guards
-- many other administrative functions, and the senior rank is not meant to
-- reach any of them.
--
-- Run once. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._assert_login_creator(p_actor_id UUID)
RETURNS public.user_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.user_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.user_accounts WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.status != 'active'
     OR v_actor.role::TEXT NOT IN ('super_admin', 'admin', 'senior_call_center') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_party_login(
  p_actor_id   UUID,
  p_contact_id UUID,
  p_username   TEXT,
  p_email      TEXT,
  p_mobile     TEXT,
  p_password   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   user_accounts%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_types   TEXT[];
  v_role    user_role;
  v_id      UUID;
BEGIN
  v_actor := public._assert_login_creator(p_actor_id);

  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;
  IF v_contact.is_active IS FALSE THEN RAISE EXCEPTION 'CONTACT_INACTIVE'; END IF;

  v_types := COALESCE(v_contact.contact_types, ARRAY[]::TEXT[]);
  IF array_length(v_types, 1) IS NULL AND v_contact.contact_type IS NOT NULL THEN
    v_types := ARRAY[v_contact.contact_type::TEXT];
  END IF;
  IF 'supplier' = ANY (v_types) THEN
    v_role := 'supplier';
  ELSIF 'partner' = ANY (v_types) THEN
    v_role := 'partner';
  ELSE
    RAISE EXCEPTION 'NOT_A_PARTY';
  END IF;

  IF coalesce(trim(p_username), '') = '' THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF length(coalesce(p_password, '')) < 8 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;
  IF coalesce(trim(p_mobile), '') = '' THEN RAISE EXCEPTION 'MOBILE_REQUIRED'; END IF;

  INSERT INTO user_accounts (
    company_id, username, email, mobile, password_hash,
    role, status, contact_id, must_change_password, created_by
  )
  VALUES (
    v_actor.company_id, trim(p_username), NULLIF(trim(p_email), ''), trim(p_mobile),
    crypt(p_password, gen_salt('bf', 12)), v_role, 'active', p_contact_id, TRUE, p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED',
          'Portal login created from the ' || v_role::TEXT || ' profile by ' || v_actor.username
          || ' (' || v_actor.role::TEXT || ')');
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_party_login(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

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
  v_actor  user_accounts%ROWTYPE;
  v_target user_accounts%ROWTYPE;
BEGIN
  v_actor := public._assert_login_creator(p_actor_id);

  IF length(coalesce(p_new_password, '')) < 8 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;
  SELECT * INTO v_target FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_target.role = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_MODIFY_SUPER_ADMIN'; END IF;
  -- Everyone but the super admin resets partner and supplier logins only.
  IF v_actor.role <> 'super_admin' AND v_target.role::TEXT NOT IN ('partner', 'supplier') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE user_accounts
     SET password_hash        = crypt(p_new_password, gen_salt('bf', 12)),
         must_change_password = TRUE,
         password_changed_at  = NULL,
         failed_attempts      = 0,
         locked_until         = NULL,
         updated_by           = p_actor_id,
         updated_at           = NOW()
   WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'PASSWORD_RESET',
          'Password reset by ' || v_actor.username || ' (' || v_actor.role::TEXT || ') — change required');
END;
$$;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect roles_allowed = 'admin, senior_call_center, super_admin' — the ranks
-- that can pass the new assertion today, from the logins that hold them.

SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = '_assert_login_creator')        AS assertion_present,
  (SELECT string_agg(DISTINCT role::TEXT, ', ' ORDER BY role::TEXT)
     FROM public.user_accounts
    WHERE status = 'active'
      AND role::TEXT IN ('super_admin', 'admin', 'senior_call_center'))         AS roles_allowed;

NOTIFY pgrst, 'reload schema';
