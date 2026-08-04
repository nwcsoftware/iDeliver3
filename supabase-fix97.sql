-- ============================================================================
-- fix97 — super-admin manage inline contact logins (any contact type)
-- ----------------------------------------------------------------------------
-- Generalises fix96 so an admin can create/modify a login (username + password)
-- for ANY contact (customer, partner, supplier, …) whose credentials live inline
-- on the contacts row, and adds a "clear login" to delete it.
--
-- Passwords stay one-way hashed (bcrypt) — they are never stored in plaintext and
-- cannot be read back. The app shows a password only at the moment it is set.
-- Safe to run multiple times.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Set (create or change) a contact's username + password.
DROP FUNCTION IF EXISTS public.admin_set_contact_credentials(UUID, TEXT, TEXT);
CREATE FUNCTION public.admin_set_contact_credentials(
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

  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND';
  END IF;

  -- Username unique across all contacts.
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
GRANT EXECUTE ON FUNCTION public.admin_set_contact_credentials(UUID, TEXT, TEXT) TO anon, authenticated;

-- Clear (delete) a contact's login entirely.
DROP FUNCTION IF EXISTS public.admin_clear_contact_credentials(UUID);
CREATE FUNCTION public.admin_clear_contact_credentials(p_contact_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_contact_id IS NULL THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  UPDATE contacts
  SET username = NULL, password_hash = NULL, updated_at = NOW()
  WHERE id = p_contact_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_clear_contact_credentials(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
