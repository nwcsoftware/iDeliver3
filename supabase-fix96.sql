-- ============================================================================
-- fix96 — admin_set_customer_credentials(): let an admin set a customer's
--         username AND password (create or change), like drivers.
-- ----------------------------------------------------------------------------
-- Customer logins live inline on the contacts row (username + password_hash).
-- Until now an admin could only RESET the password (admin_reset_customer_password),
-- and only if the customer had already self-registered a username — so a super
-- admin had no way to CREATE a login for a customer. This mirrors
-- admin_set_driver_credentials (fix54/57) but targets contact_type = 'customer':
-- it sets both the username (unique, lowercased) and the password.
--
-- The old password is never returned; only the new password the admin typed in
-- the app is shown, before it is hashed here.
-- Safe to run multiple times.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.admin_set_customer_credentials(UUID, TEXT, TEXT);

CREATE FUNCTION public.admin_set_customer_credentials(
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
  IF p_contact_id IS NULL                       THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  IF v_username IS NULL                          THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF length(v_username) < 3                      THEN RAISE EXCEPTION 'USERNAME_TOO_SHORT'; END IF;
  IF length(coalesce(p_new_password, '')) < 12   THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  -- The contact must exist and be a customer.
  IF NOT EXISTS (
    SELECT 1 FROM contacts
    WHERE id = p_contact_id
      AND (contact_type = 'customer' OR 'customer' = ANY(coalesce(contact_types, ARRAY[]::text[])))
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  -- Username must be unique across all contacts.
  IF EXISTS (
    SELECT 1 FROM contacts
    WHERE lower(coalesce(contacts.username, '')) = v_username
      AND id <> p_contact_id
  ) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  UPDATE contacts
  SET username      = v_username,
      password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      updated_at    = NOW()
  WHERE id = p_contact_id
  RETURNING contacts.username INTO v_username;

  RETURN QUERY SELECT p_contact_id, v_username::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_customer_credentials(UUID, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
