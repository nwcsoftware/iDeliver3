-- ============================================================================
-- fix162 — the CUSTOMER APP login on a contact: who may set it, and the
--          username fixed once saved for the Senior Call Center rank
-- ----------------------------------------------------------------------------
-- A contact's own username and password open the 3asari3 customer mobile app
-- (not the partner portal). Until now they were set by
-- admin_set_contact_credentials and wiped by admin_clear_contact_credentials —
-- two functions that took NO acting user at all. The page showed them to
-- administrators only, but the database would do it for anyone holding the
-- anon key, for any contact.
--
-- They are replaced by two functions that check who is asking:
--
--   contact_login_set     super admin, admin, senior call center
--                         (_assert_login_creator, fix161). Creates the login,
--                         or resets its password.
--                         CHANGING AN EXISTING USERNAME: the super admin only.
--                         An admin or a Senior Call Center user sets the
--                         username once; after it is saved it is fixed for them
--                         (USERNAME_LOCKED) — they can still reset the password.
--   contact_login_clear   super admin only, as the page already had it.
--
-- The old two are withdrawn from the anon and authenticated roles so they can
-- no longer be called at all. Run this, then deploy the app straight after: the
-- page still on the old code calls the old functions and would get "permission
-- denied" in between.
--
-- Run once. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.contact_login_set(
  p_actor_id     UUID,
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
  v_actor    user_accounts%ROWTYPE;
  v_username TEXT := nullif(lower(trim(coalesce(p_username, ''))), '');
  v_current  TEXT;
BEGIN
  v_actor := public._assert_login_creator(p_actor_id);

  IF p_contact_id IS NULL                       THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  IF v_username IS NULL                          THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF length(v_username) < 3                      THEN RAISE EXCEPTION 'USERNAME_TOO_SHORT'; END IF;
  IF length(coalesce(p_new_password, '')) < 12   THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  SELECT c.username INTO v_current FROM contacts c WHERE c.id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;

  -- Once saved, the username is fixed for everyone but the super admin.
  IF v_current IS NOT NULL AND lower(v_current) <> v_username
     AND v_actor.role::TEXT <> 'super_admin' THEN
    RAISE EXCEPTION 'USERNAME_LOCKED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM contacts c
     WHERE lower(coalesce(c.username, '')) = v_username
       AND c.id <> p_contact_id
  ) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN';
  END IF;

  UPDATE contacts c
     SET username      = v_username,
         password_hash = crypt(p_new_password, gen_salt('bf', 12)),
         updated_at    = NOW()
   WHERE c.id = p_contact_id
  RETURNING c.username INTO v_username;

  RETURN QUERY SELECT p_contact_id, v_username::TEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.contact_login_set(UUID, UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_login_clear(p_actor_id UUID, p_contact_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);
  IF p_contact_id IS NULL THEN RAISE EXCEPTION 'CONTACT_REQUIRED'; END IF;
  UPDATE contacts SET username = NULL, password_hash = NULL, updated_at = NOW()
   WHERE id = p_contact_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.contact_login_clear(UUID, UUID) TO anon, authenticated;

-- The unchecked pair: no longer callable from the application's keys.
DO $$
BEGIN
  IF to_regprocedure('public.admin_set_contact_credentials(uuid, text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.admin_set_contact_credentials(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.admin_clear_contact_credentials(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.admin_clear_contact_credentials(UUID) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect new_functions = 2 and old_callable_by_anon = 0.

SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('contact_login_set', 'contact_login_clear')) AS new_functions,
  (SELECT COUNT(*) FROM pg_proc p
    WHERE p.proname IN ('admin_set_contact_credentials', 'admin_clear_contact_credentials')
      AND has_function_privilege('anon', p.oid, 'EXECUTE'))                                  AS old_callable_by_anon;

NOTIFY pgrst, 'reload schema';
