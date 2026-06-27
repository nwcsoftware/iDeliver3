-- =============================================================================
-- fix69: Self-service username change for the super_admin (the developer)
--
-- The super_admin can change their own username (and password, via the existing
-- change_password RPC). Username changes are reserved for the super_admin role;
-- every other account's username stays admin-set (see fix17).
--
-- Verifies the current password before applying the change and enforces
-- username uniqueness. Returns a TEXT status code the client maps to a message:
--   OK | BAD_PASSWORD | USERNAME_TAKEN | USERNAME_REQUIRED | NOT_AUTHORIZED | USER_NOT_FOUND
--
-- Same custom-auth posture as the rest of the app (tighten with real JWT claims
-- before production). Safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.change_username(
  p_user_id      UUID,
  p_password     TEXT,
  p_new_username TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user user_accounts%ROWTYPE;
  v_new  TEXT := trim(p_new_username);
BEGIN
  SELECT * INTO v_user FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN 'USER_NOT_FOUND'; END IF;

  -- Self-service username change is reserved for the super_admin (the developer).
  IF v_user.role != 'super_admin' THEN RETURN 'NOT_AUTHORIZED'; END IF;

  -- Confirm identity with the current password before changing the username.
  IF crypt(p_password, v_user.password_hash) != v_user.password_hash THEN
    RETURN 'BAD_PASSWORD';
  END IF;

  IF v_new = '' THEN RETURN 'USERNAME_REQUIRED'; END IF;

  -- No change requested — treat as success so the UI is idempotent.
  IF v_new = v_user.username THEN RETURN 'OK'; END IF;

  IF EXISTS (SELECT 1 FROM user_accounts WHERE username = v_new AND id != p_user_id) THEN
    RETURN 'USERNAME_TAKEN';
  END IF;

  UPDATE user_accounts
  SET username   = v_new,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'USERNAME_CHANGE', 'Username changed to ' || v_new);

  RETURN 'OK';
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_username(UUID, TEXT, TEXT) TO anon, authenticated;
