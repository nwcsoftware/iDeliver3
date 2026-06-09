-- ============================================================================
-- fix32 — Random, unique 16-digit account numbers
-- ----------------------------------------------------------------------------
-- Previously account numbers were sequential and zero-padded to 12 digits
-- (e.g. "0000 0000 0001"). They are now random 16-digit numbers that look like
-- a card number ("4425 6631 4124 0241"), generated with a uniqueness check so
-- the same number is never issued twice.
--
-- The client (src/lib/accountNumber.js) generates these for UI-created records.
-- This migration provides a matching generator for server-side RPCs and patches
-- the customer mobile-app registration to use it.
-- ============================================================================

-- ── Reusable random 16-digit unique account-number generator ─────────────────
-- Returns a 16-digit string whose first digit is 1–9 (so it is always 16
-- significant digits). Checks the contacts table for collisions and retries.
CREATE OR REPLACE FUNCTION public.generate_unique_contact_account_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_candidate TEXT;
  v_attempts  INT := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    -- First digit 1–9, then 15 random digits 0–9.
    v_candidate := (1 + floor(random() * 9))::INT::TEXT;
    FOR i IN 1..15 LOOP
      v_candidate := v_candidate || floor(random() * 10)::INT::TEXT;
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM contacts WHERE account_number = v_candidate
    );
    -- Safety valve: 16 random digits make collisions astronomically unlikely.
    EXIT WHEN v_attempts >= 25;
  END LOOP;

  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_unique_contact_account_number() TO anon, authenticated;

-- ── Patch customer_register_with_password to use the new generator ───────────
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
    -- Random, unique 16-digit account number ("4425 6631 4124 0241").
    v_account_number := public.generate_unique_contact_account_number();

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
