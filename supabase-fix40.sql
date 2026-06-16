-- ============================================================================
-- fix40 - Admin reset of a customer's mobile-app password
-- ----------------------------------------------------------------------------
-- Customer credentials live on the contacts row (username + password_hash).
-- Admins may view the existing username, but this RPC only resets the password.
-- The old password is never returned or exposed; only the new password the admin
-- typed/generated in the app is shown before it is hashed here.
-- ============================================================================

-- Replace earlier signatures if they were already created.
DROP FUNCTION IF EXISTS public.admin_reset_customer_password(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_reset_customer_password(UUID, TEXT, TEXT);

CREATE FUNCTION public.admin_reset_customer_password(
  p_contact_id   UUID,
  p_new_password TEXT
)
RETURNS TABLE (contact_id UUID, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT;
BEGIN
  IF p_contact_id IS NULL                      THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  IF length(coalesce(p_new_password, '')) < 12 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  UPDATE contacts
  SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      updated_at    = NOW()
  WHERE id = p_contact_id
    AND contact_type = 'customer'
    AND nullif(trim(contacts.username), '') IS NOT NULL
  RETURNING contacts.username INTO v_username;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM contacts
      WHERE id = p_contact_id
        AND contact_type = 'customer'
    ) THEN
      RAISE EXCEPTION 'USERNAME_REQUIRED';
    END IF;

    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  RETURN QUERY SELECT p_contact_id, v_username::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_customer_password(UUID, TEXT) TO anon, authenticated;
