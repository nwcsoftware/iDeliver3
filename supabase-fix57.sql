-- ============================================================================
-- fix57 — admin_set_driver_credentials(): fix ambiguous "username" reference
-- ----------------------------------------------------------------------------
-- fix54 declared RETURNS TABLE (contact_id UUID, username TEXT). Those output
-- columns are in-scope variables inside the function body, so the bare
-- `username` in the uniqueness check (lower(coalesce(username, ''))) was
-- ambiguous with the contacts.username column — Postgres raised:
--   column reference "username" is ambiguous
-- and the password save failed.
--
-- This recreates the function with that reference qualified as
-- contacts.username. Behaviour is otherwise identical to fix54.
-- Safe to run multiple times.
-- ============================================================================

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
  -- Qualify contacts.username so it isn't read as the OUT column variable.
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
    AND contact_type = 'driver'
  RETURNING contacts.username INTO v_username;

  RETURN QUERY SELECT p_contact_id, v_username::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_driver_credentials(UUID, TEXT, TEXT) TO anon, authenticated;
