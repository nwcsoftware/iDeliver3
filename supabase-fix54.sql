-- ============================================================================
-- fix54 - Admin set/reset of a driver's login credentials
-- ----------------------------------------------------------------------------
-- Drivers live on the contacts row (contact_type = 'driver') and, like
-- customers, store credentials inline (username + password_hash). Unlike
-- customers, drivers have no self-registration flow, so an admin sets BOTH the
-- username and the password from the driver form.
--
-- Mirrors admin_reset_customer_password (fix40) but:
--   * targets contact_type = 'driver'
--   * also sets the username (normalised to lowercase, must be unique)
-- The old password is never returned; only the new password the admin
-- typed/generated in the app is shown before it is hashed here.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Replace earlier signatures if they were already created.
DROP FUNCTION IF EXISTS public.admin_set_driver_credentials(UUID, TEXT, TEXT);

CREATE FUNCTION public.admin_set_driver_credentials(
  p_contact_id   UUID,
  p_username     TEXT,
  p_new_password TEXT
)
RETURNS TABLE (contact_id UUID, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT := nullif(lower(trim(coalesce(p_username, ''))), '');
BEGIN
  IF p_contact_id IS NULL                      THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  IF v_username IS NULL                         THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF length(v_username) < 3                     THEN RAISE EXCEPTION 'USERNAME_TOO_SHORT'; END IF;
  IF length(coalesce(p_new_password, '')) < 12  THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  -- Driver must exist.
  IF NOT EXISTS (
    SELECT 1 FROM contacts
    WHERE id = p_contact_id AND contact_type = 'driver'
  ) THEN
    RAISE EXCEPTION 'DRIVER_NOT_FOUND';
  END IF;

  -- Username must not already belong to a different contact (any type).
  IF EXISTS (
    SELECT 1 FROM contacts
    WHERE lower(coalesce(username, '')) = v_username
      AND id <> p_contact_id
  ) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  UPDATE contacts
  SET username      = v_username,
      password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      updated_at    = NOW()
  WHERE id = p_contact_id
    AND contact_type = 'driver'
  RETURNING contacts.username INTO v_username;

  RETURN QUERY SELECT p_contact_id, v_username::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_driver_credentials(UUID, TEXT, TEXT) TO anon, authenticated;
