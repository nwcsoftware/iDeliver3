-- ============================================================================
-- fix160 — a partner may have several logins, and nobody but the super admin
--          may move, change or switch one off
-- ----------------------------------------------------------------------------
-- WHAT CHANGES
--
-- 1. A partner or supplier may hold SEVERAL logins. The one-login-per-contact
--    rule (UNIQUE on user_accounts.contact_id) is dropped.
--
-- 2. Each login carries ITS OWN subscription. A subscription row for a party
--    now names both the contact (whose business it is) and the login (who it
--    lets in). Office seats keep naming only the login. The rule becomes "at
--    least one of the two", instead of "exactly one".
--    Existing rows are attached to their login where the contact has exactly
--    one — today, all of them.
--
-- 3. Who may do what, enforced HERE rather than only on the screen:
--
--      admin_create_party_login   admin or super admin. Creates a login for a
--                                 partner / supplier FROM ITS PROFILE: the
--                                 link is set by the contact passed in and can
--                                 never be chosen or changed afterwards. Active,
--                                 password to be changed on first sign-in.
--      admin_create_user          super admin only (the User Accounts page)
--      admin_update_user          super admin only — username, role, link
--      admin_set_user_status      super admin only — activate / deactivate
--      admin_delete_user          super admin only (already, fix135)
--      admin_reset_password       admin: partner / supplier logins only, and
--                                 always forces a change at the next sign-in.
--                                 super admin: any login.
--
--    The Senior Call Center and Call Center ranks can do none of it:
--    _assert_admin accepts only 'admin' and 'super_admin'.
--
-- WHAT THIS DOES NOT CHANGE: every function here still takes the acting user's
-- id from the caller (p_actor_id), as the whole application does. It stops
-- anybody using the app from stepping around the rules; it is not proof against
-- somebody forging that id with the anon key and a terminal. That needs real
-- server-side sign-in, a separate piece of work.
--
-- Run once. Safe to re-run.
-- ============================================================================

-- ── 1. several logins per contact ───────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.user_accounts'::regclass
       AND con.contype  = 'u'
       AND pg_get_constraintdef(con.oid) ILIKE '%(contact_id)%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_accounts DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'dropped %', r.conname;
  END LOOP;
END $$;

-- A unique INDEX would enforce the same rule; drop that too if one exists.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT i.indexrelid::regclass::TEXT AS idx
      FROM pg_index i
     WHERE i.indrelid = 'public.user_accounts'::regclass
       AND i.indisunique AND NOT i.indisprimary
       AND pg_get_indexdef(i.indexrelid) ILIKE '%(contact_id)%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', r.idx);
    RAISE NOTICE 'dropped index %', r.idx;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_accounts_contact ON public.user_accounts (contact_id);

-- ── 2. a subscription belongs to a login ────────────────────────────────────
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_owner_chk;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_owner_chk
  CHECK (contact_id IS NOT NULL OR user_account_id IS NOT NULL);

COMMENT ON COLUMN public.subscriptions.user_account_id IS
  'The login this subscription lets in (fix160). Party rows name the contact AND the login; office seats name only the login.';

-- Attach each existing party row to its login, where the contact has one.
UPDATE public.subscriptions s
   SET user_account_id = ua.id
  FROM public.user_accounts ua
 WHERE s.user_account_id IS NULL
   AND s.contact_id = ua.contact_id
   AND ua.role::TEXT IN ('partner', 'supplier')
   AND (SELECT COUNT(*) FROM public.user_accounts x
         WHERE x.contact_id = s.contact_id AND x.role::TEXT IN ('partner', 'supplier')) = 1;

-- ── 3. who may do what ──────────────────────────────────────────────────────

-- Create a partner / supplier login from the contact's profile.
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
  v_actor := public._assert_admin(p_actor_id);

  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;
  IF v_contact.is_active IS FALSE THEN RAISE EXCEPTION 'CONTACT_INACTIVE'; END IF;

  -- The role follows from what the contact IS; the caller cannot choose it.
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
    v_actor.company_id,
    trim(p_username),
    NULLIF(trim(p_email), ''),
    trim(p_mobile),
    crypt(p_password, gen_salt('bf', 12)),
    v_role,
    'active',
    p_contact_id,
    TRUE,                       -- the person receiving it sets their own
    p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED',
          'Login created from the ' || v_role::TEXT || ' profile by ' || v_actor.username);

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_party_login(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- The User Accounts page: super admin only.
CREATE OR REPLACE FUNCTION public.admin_create_user(
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
  v_actor := public._assert_super_admin(p_actor_id);

  IF p_role = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_CREATE_SUPER_ADMIN'; END IF;
  IF coalesce(trim(p_username), '') = '' THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF coalesce(p_password, '') = '' THEN RAISE EXCEPTION 'PASSWORD_REQUIRED'; END IF;

  INSERT INTO user_accounts (
    company_id, username, email, mobile, password_hash,
    role, status, contact_id, must_change_password, created_by
  )
  VALUES (
    v_actor.company_id, trim(p_username), NULLIF(trim(p_email), ''), p_mobile,
    crypt(p_password, gen_salt('bf', 12)), p_role, COALESCE(p_status, 'active'),
    p_contact_id, TRUE, p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED', 'Account created by the super admin');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
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
  PERFORM public._assert_super_admin(p_actor_id);

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
         contact_id = COALESCE(p_contact_id, contact_id),
         updated_by = p_actor_id,
         updated_at = NOW()
   WHERE id = p_user_id;

  IF p_contact_id IS NOT NULL AND p_contact_id IS DISTINCT FROM v_target.contact_id THEN
    INSERT INTO user_logbook (user_id, action, description)
    VALUES (p_user_id, 'LINK_CHANGED', 'Moved to another contact by the super admin');
  END IF;
END;
$$;

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
  PERFORM public._assert_super_admin(p_actor_id);

  IF p_user_id = p_actor_id THEN RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS'; END IF;
  SELECT * INTO v_target FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_target.role = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_MODIFY_SUPER_ADMIN'; END IF;

  UPDATE user_accounts
     SET status         = p_status,
         deactivated_by = CASE WHEN p_status = 'inactive' THEN p_actor_id ELSE NULL END,
         deactivated_at = CASE WHEN p_status = 'inactive' THEN NOW() ELSE NULL END,
         updated_by     = p_actor_id,
         updated_at     = NOW()
   WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'STATUS_CHANGE', 'Status set to ' || p_status::TEXT || ' by the super admin');
END;
$$;

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
  v_actor := public._assert_admin(p_actor_id);

  IF length(coalesce(p_new_password, '')) < 8 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;
  SELECT * INTO v_target FROM user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_target.role = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_MODIFY_SUPER_ADMIN'; END IF;
  -- An administrator resets partner and supplier logins only; office logins
  -- are the super admin's.
  IF v_actor.role <> 'super_admin' AND v_target.role::TEXT NOT IN ('partner', 'supplier') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE user_accounts
     SET password_hash        = crypt(p_new_password, gen_salt('bf', 12)),
         must_change_password = TRUE,        -- always: the holder sets their own
         password_changed_at  = NULL,
         failed_attempts      = 0,
         locked_until         = NULL,
         updated_by           = p_actor_id,
         updated_at           = NOW()
   WHERE id = p_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (p_user_id, 'PASSWORD_RESET', 'Password reset by ' || v_actor.username || ' — change required');
END;
$$;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: one_login_rule_left = 0; party_rows_without_login = the rows of
-- contacts that have no login (My Line today); functions_present = 5.

SELECT
  (SELECT COUNT(*) FROM pg_constraint
    WHERE conrelid = 'public.user_accounts'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(contact_id)%')                    AS one_login_rule_left,
  (SELECT COUNT(*) FROM public.subscriptions
    WHERE contact_id IS NOT NULL AND user_account_id IS NOT NULL)              AS party_rows_attached,
  (SELECT COUNT(*) FROM public.subscriptions
    WHERE contact_id IS NOT NULL AND user_account_id IS NULL)                  AS party_rows_without_login,
  (SELECT COUNT(*) FROM pg_proc
    WHERE proname IN ('admin_create_party_login', 'admin_create_user', 'admin_update_user',
                      'admin_set_user_status', 'admin_reset_password'))        AS functions_present;

NOTIFY pgrst, 'reload schema';
