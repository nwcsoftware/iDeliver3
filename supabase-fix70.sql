-- =============================================================================
-- fix70: link a user account to a contact (2nd-party supplier/partner logins)
--
-- The user_accounts.contact_id column already exists and verify_login already
-- returns it, but admin_create_user / admin_update_user never populated it — so
-- supplier & partner logins were unlinked and the app could not tell which
-- contact a signed-in 2nd party "is".
--
-- This adds an optional p_contact_id to both RPCs:
--   • admin_create_user stores it on the new account.
--   • admin_update_user sets it only when provided (COALESCE), so ordinary edits
--     never wipe an existing link.
--
-- The frontend passes the contact's id when an admin creates the login from the
-- contact form's "Create User Profile" button. Suppliers/partners then see only
-- the orders that reference their own contact (delivery_packages.provider_id or
-- retail_goods_invoices.contact_id).
--
-- Safe to run multiple times.
-- =============================================================================

-- Old signatures are dropped first so the added default parameter doesn't create
-- an ambiguous overload.
DROP FUNCTION IF EXISTS public.admin_create_user(UUID, TEXT, TEXT, TEXT, TEXT, user_role, user_status);
DROP FUNCTION IF EXISTS public.admin_update_user(UUID, UUID, TEXT, TEXT, TEXT, user_role);


-- ── Create a user (now accepts an optional contact link) ─────────────────────
CREATE FUNCTION public.admin_create_user(
  p_actor_id   UUID,
  p_username   TEXT,
  p_email      TEXT,
  p_mobile     TEXT,
  p_password   TEXT,
  p_role       user_role,
  p_status     user_status DEFAULT 'active',
  p_contact_id UUID        DEFAULT NULL
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
    role, status, contact_id, must_change_password, created_by
  )
  VALUES (
    v_actor.company_id,
    trim(p_username),
    NULLIF(trim(p_email), ''),
    p_mobile,
    crypt(p_password, gen_salt('bf', 12)),
    p_role,
    COALESCE(p_status, 'active'),
    p_contact_id,
    TRUE,                       -- force change on first login
    p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED', 'Account created by admin');

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(UUID, TEXT, TEXT, TEXT, TEXT, user_role, user_status, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(UUID, TEXT, TEXT, TEXT, TEXT, user_role, user_status, UUID) TO authenticated;


-- ── Update a user (optionally (re)link a contact) ────────────────────────────
CREATE FUNCTION public.admin_update_user(
  p_actor_id   UUID,
  p_user_id    UUID,
  p_username   TEXT,
  p_email      TEXT,
  p_mobile     TEXT,
  p_role       user_role,
  p_contact_id UUID DEFAULT NULL
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
      -- Only overwrite the contact link when a value is supplied.
      contact_id = COALESCE(p_contact_id, contact_id),
      updated_by = p_actor_id,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, TEXT, TEXT, user_role, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID, UUID, TEXT, TEXT, TEXT, user_role, UUID) TO authenticated;
