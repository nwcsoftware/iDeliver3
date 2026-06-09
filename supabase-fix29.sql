-- =============================================================================
-- fix29: Contacts-based customer authentication (replaces user_accounts for customers)
--
-- Customer mobile sign-in now authenticates against the contacts table using
-- contacts.username + contacts.password_hash (added in fix28, re-ensured here),
-- instead of creating/looking up a user_accounts row.
--
--   * customer_login                 — NEW: verify a customer by username/mobile/email + password
--   * customer_register_with_password — REPLACED: stores credentials on the contact
--   * customer_update_mobile          — REPLACED: updates the contact only
--
-- Returned rows keep the same column shape the mobile app already consumes, with
-- user_id = NULL (there is no user_accounts row for customers anymore — the app
-- keys everything off contact_id, and its logout_user call self-skips when null).
--
-- Idempotent / safe to re-run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS username      VARCHAR(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_username_unique
  ON contacts (lower(username))
  WHERE username IS NOT NULL;

-- ── customer_login ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.customer_login(TEXT, TEXT);
CREATE FUNCTION public.customer_login(
  p_login    TEXT,   -- username, mobile, or email
  p_password TEXT
)
RETURNS TABLE (
  user_id              UUID,
  username             TEXT,
  email                TEXT,
  mobile               TEXT,
  role                 user_role,
  status               user_status,
  company_id           UUID,
  branch_id            UUID,
  contact_id           UUID,
  permissions          JSONB,
  first_name           TEXT,
  last_name            TEXT,
  must_change_password BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_login   TEXT := lower(trim(p_login));
  v_contact contacts%ROWTYPE;
BEGIN
  IF coalesce(v_login, '') = '' OR coalesce(p_password, '') = '' THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  SELECT * INTO v_contact
  FROM contacts AS c
  WHERE c.contact_type = 'customer'
    AND coalesce(c.is_active, TRUE) = TRUE
    AND c.password_hash IS NOT NULL
    AND ( lower(c.username) = v_login
       OR lower(c.mobile)   = v_login
       OR lower(c.email)    = v_login )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  IF crypt(p_password, v_contact.password_hash) <> v_contact.password_hash THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  RETURN QUERY SELECT
    NULL::UUID,                                            -- user_id (no user_accounts row)
    coalesce(v_contact.username, v_contact.mobile)::TEXT,
    v_contact.email::TEXT,
    v_contact.mobile::TEXT,
    'customer'::user_role,
    'active'::user_status,
    v_contact.company_id,
    v_contact.branch_id,
    v_contact.id,                                          -- contact_id
    '{}'::JSONB,
    v_contact.first_name::TEXT,
    coalesce(v_contact.last_name, '')::TEXT,
    FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_login(TEXT, TEXT) TO anon, authenticated;

-- ── customer_register_with_password (contacts-based) ─────────────────────────
DROP FUNCTION IF EXISTS public.customer_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION public.customer_register_with_password(
  p_company_id   UUID,
  p_full_name    TEXT,
  p_mobile       TEXT,
  p_email        TEXT,
  p_otp_channel  TEXT,
  p_password     TEXT
)
RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  email       TEXT,
  mobile      TEXT,
  role        user_role,
  status      user_status,
  company_id  UUID,
  branch_id   UUID,
  contact_id  UUID,
  permissions JSONB,
  first_name  TEXT,
  last_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mobile      TEXT := trim(p_mobile);
  v_email       TEXT := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_otp_channel TEXT := lower(trim(coalesce(p_otp_channel, 'whatsapp')));
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_account_number TEXT;
  v_contact_id  UUID;
  v_branch_id   UUID;
  v_hash        TEXT;
BEGIN
  IF p_company_id IS NULL                              THEN RAISE EXCEPTION 'COMPANY_REQUIRED'; END IF;
  IF coalesce(trim(p_full_name), '') = ''              THEN RAISE EXCEPTION 'FULL_NAME_REQUIRED'; END IF;
  IF coalesce(v_mobile, '') = ''                       THEN RAISE EXCEPTION 'MOBILE_REQUIRED'; END IF;
  IF v_otp_channel NOT IN ('whatsapp', 'email')        THEN RAISE EXCEPTION 'INVALID_OTP_CHANNEL'; END IF;
  IF v_otp_channel = 'email' AND v_email IS NULL       THEN RAISE EXCEPTION 'EMAIL_REQUIRED_FOR_OTP'; END IF;
  IF length(coalesce(p_password, '')) < 8              THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  v_hash       := crypt(p_password, gen_salt('bf', 12));
  v_first_name := split_part(trim(p_full_name), ' ', 1);
  v_last_name  := nullif(trim(substr(trim(p_full_name), length(v_first_name) + 1)), '');

  -- An existing customer contact reachable by this mobile / email / username.
  SELECT id, branch_id INTO v_contact_id, v_branch_id
  FROM contacts AS c
  WHERE c.contact_type = 'customer'
    AND ( c.mobile = v_mobile
       OR lower(c.username) = lower(v_mobile)
       OR (v_email IS NOT NULL AND lower(c.email) = v_email) )
  LIMIT 1;

  IF v_contact_id IS NOT NULL THEN
    -- Already has credentials → duplicate registration.
    IF EXISTS (SELECT 1 FROM contacts WHERE id = v_contact_id AND password_hash IS NOT NULL) THEN
      RAISE EXCEPTION 'CUSTOMER_ALREADY_EXISTS';
    END IF;
    -- Claim the existing credential-less contact.
    UPDATE contacts
    SET username        = v_mobile,
        password_hash   = v_hash,
        email           = COALESCE(email, v_email),
        whatsapp_number = COALESCE(whatsapp_number, v_mobile),
        updated_at      = NOW()
    WHERE id = v_contact_id;
  ELSE
    SELECT lpad(
      (COALESCE(MAX(NULLIF(regexp_replace(account_number, '\D', '', 'g'), '')::BIGINT), 0) + 1)::TEXT,
      12, '0'
    )
    INTO v_account_number
    FROM contacts AS customer_contact
    WHERE customer_contact.contact_type = 'customer';

    INSERT INTO contacts (
      company_id, contact_type, account_number, credit_debit_allowed,
      first_name, last_name, mobile, mobile_verified, whatsapp_number,
      email, email_verified, is_active, username, password_hash, notes
    )
    VALUES (
      p_company_id, 'customer', v_account_number, FALSE,
      v_first_name, coalesce(v_last_name, ''), v_mobile, FALSE, v_mobile,
      v_email, FALSE, TRUE, v_mobile, v_hash, 'Created from customer mobile registration'
    )
    RETURNING id, branch_id INTO v_contact_id, v_branch_id;
  END IF;

  RETURN QUERY SELECT
    NULL::UUID,                       -- user_id (no user_accounts row)
    v_mobile::TEXT,                   -- username
    v_email::TEXT,
    v_mobile::TEXT,
    'customer'::user_role,
    'active'::user_status,
    p_company_id,
    v_branch_id,
    v_contact_id,                     -- contact_id
    '{}'::JSONB,
    v_first_name::TEXT,
    coalesce(v_last_name, '')::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── customer_update_mobile (contacts-based) ──────────────────────────────────
DROP FUNCTION IF EXISTS public.customer_update_mobile(UUID, UUID, TEXT);
CREATE FUNCTION public.customer_update_mobile(
  p_user_id    UUID,   -- kept for signature compatibility (unused; no user_accounts)
  p_contact_id UUID,
  p_mobile     TEXT
)
RETURNS TABLE (
  user_id    UUID,
  contact_id UUID,
  mobile     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mobile  TEXT := trim(p_mobile);
  v_contact contacts%ROWTYPE;
BEGIN
  IF p_contact_id IS NULL          THEN RAISE EXCEPTION 'CUSTOMER_SESSION_REQUIRED'; END IF;
  IF coalesce(v_mobile, '') = ''   THEN RAISE EXCEPTION 'MOBILE_REQUIRED'; END IF;

  SELECT * INTO v_contact
  FROM contacts AS c
  WHERE c.id = p_contact_id
    AND c.contact_type = 'customer'
    AND coalesce(c.is_active, TRUE) = TRUE
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;

  IF EXISTS (SELECT 1 FROM contacts WHERE mobile = v_mobile AND id <> p_contact_id) THEN
    RAISE EXCEPTION 'MOBILE_ALREADY_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM contacts WHERE lower(username) = lower(v_mobile) AND id <> p_contact_id) THEN
    RAISE EXCEPTION 'MOBILE_ALREADY_EXISTS';
  END IF;

  UPDATE contacts
  SET mobile          = v_mobile,
      whatsapp_number = v_mobile,
      -- Keep username tracking the mobile only if it already did (e.g. not an email login).
      username        = CASE
                          WHEN username IS NULL
                            OR lower(coalesce(username, '')) = lower(coalesce(v_contact.mobile, ''))
                          THEN v_mobile ELSE username END,
      mobile_verified = FALSE,
      updated_at      = NOW()
  WHERE id = p_contact_id;

  RETURN QUERY SELECT p_contact_id, p_contact_id, v_mobile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_update_mobile(UUID, UUID, TEXT) TO anon, authenticated;
