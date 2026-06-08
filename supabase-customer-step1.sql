-- =============================================================================
-- iDeliver III Customer App - Step 1 Database Readiness
-- Run this in Supabase SQL Editor before public customer registration/order flows.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

CREATE OR REPLACE FUNCTION public.customer_register_with_password(
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
  v_existing_user_id UUID;
  v_user_id     UUID;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_REQUIRED';
  END IF;

  IF coalesce(trim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED';
  END IF;

  IF coalesce(v_mobile, '') = '' THEN
    RAISE EXCEPTION 'MOBILE_REQUIRED';
  END IF;

  IF v_otp_channel NOT IN ('whatsapp', 'email') THEN
    RAISE EXCEPTION 'INVALID_OTP_CHANNEL';
  END IF;

  IF v_otp_channel = 'email' AND v_email IS NULL THEN
    RAISE EXCEPTION 'EMAIL_REQUIRED_FOR_OTP';
  END IF;

  IF length(coalesce(p_password, '')) < 8 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
  END IF;

  SELECT id
  INTO v_existing_user_id
  FROM user_accounts AS existing_user
  WHERE existing_user.username = v_mobile
     OR coalesce(existing_user.mobile, '') = v_mobile
     OR (v_email IS NOT NULL AND lower(coalesce(existing_user.email, '')) = v_email)
  LIMIT 1;

  IF v_existing_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'CUSTOMER_ALREADY_EXISTS';
  END IF;

  SELECT id
  INTO v_contact_id
  FROM contacts AS existing_contact
  WHERE existing_contact.contact_type = 'customer'
    AND (
      coalesce(existing_contact.mobile, '') = v_mobile
      OR (v_email IS NOT NULL AND lower(coalesce(existing_contact.email, '')) = v_email)
    )
  LIMIT 1;

  v_first_name := split_part(trim(p_full_name), ' ', 1);
  v_last_name := nullif(trim(substr(trim(p_full_name), length(v_first_name) + 1)), '');

  IF v_contact_id IS NULL THEN
    SELECT lpad(
      (
        COALESCE(MAX(NULLIF(regexp_replace(account_number, '\D', '', 'g'), '')::BIGINT), 0) + 1
      )::TEXT,
      12,
      '0'
    )
    INTO v_account_number
    FROM contacts AS customer_contact
    WHERE customer_contact.contact_type = 'customer';

    INSERT INTO contacts (
      company_id,
      contact_type,
      account_number,
      credit_debit_allowed,
      first_name,
      last_name,
      mobile,
      mobile_verified,
      whatsapp_number,
      email,
      email_verified,
      is_active,
      notes
    )
    VALUES (
      p_company_id,
      'customer',
      v_account_number,
      FALSE,
      v_first_name,
      coalesce(v_last_name, ''),
      v_mobile,
      FALSE,
      v_mobile,
      v_email,
      FALSE,
      TRUE,
      'Created from customer mobile registration'
    )
    RETURNING id INTO v_contact_id;
  ELSE
    IF EXISTS (SELECT 1 FROM user_accounts AS linked_user WHERE linked_user.contact_id = v_contact_id) THEN
      RAISE EXCEPTION 'CUSTOMER_ALREADY_EXISTS';
    END IF;

    UPDATE contacts
    SET
      email = COALESCE(email, v_email),
      whatsapp_number = COALESCE(whatsapp_number, v_mobile),
      updated_at = NOW()
    WHERE id = v_contact_id;
  END IF;

  INSERT INTO user_accounts (
    contact_id,
    company_id,
    username,
    email,
    mobile,
    password_hash,
    role,
    status,
    permissions,
    password_changed_at,
    must_change_password
  )
  VALUES (
    v_contact_id,
    p_company_id,
    v_mobile,
    v_email,
    v_mobile,
    crypt(p_password, gen_salt('bf', 12)),
    'customer',
    'active',
    '{}',
    NOW(),
    FALSE
  )
  RETURNING id INTO v_user_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_user_id, 'CUSTOMER_REGISTERED', 'Customer registered from mobile app');

  RETURN QUERY
  SELECT
    u.id,
    u.username::TEXT,
    u.email::TEXT,
    u.mobile::TEXT,
    u.role,
    u.status,
    u.company_id,
    u.branch_id,
    u.contact_id,
    u.permissions,
    ct.first_name::TEXT,
    ct.last_name::TEXT
  FROM user_accounts AS u
  JOIN contacts AS ct ON ct.id = u.contact_id
  WHERE u.id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.customer_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.customer_update_mobile(
  p_user_id UUID,
  p_contact_id UUID,
  p_mobile TEXT
)
RETURNS TABLE (
  user_id UUID,
  contact_id UUID,
  mobile TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mobile TEXT := trim(p_mobile);
  v_user user_accounts%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_SESSION_REQUIRED';
  END IF;

  IF coalesce(v_mobile, '') = '' THEN
    RAISE EXCEPTION 'MOBILE_REQUIRED';
  END IF;

  SELECT *
  INTO v_user
  FROM user_accounts AS ua
  WHERE ua.id = p_user_id
    AND ua.contact_id = p_contact_id
    AND ua.role = 'customer'
    AND ua.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM contacts AS c
    WHERE c.mobile = v_mobile
      AND c.id <> p_contact_id
  ) THEN
    RAISE EXCEPTION 'MOBILE_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM user_accounts AS ua
    WHERE (ua.mobile = v_mobile OR ua.username = v_mobile)
      AND ua.id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'MOBILE_ALREADY_EXISTS';
  END IF;

  UPDATE contacts
  SET
    mobile = v_mobile,
    whatsapp_number = v_mobile,
    mobile_verified = FALSE,
    updated_at = NOW()
  WHERE id = p_contact_id;

  UPDATE user_accounts
  SET
    mobile = v_mobile,
    username = v_mobile,
    updated_at = NOW()
  WHERE id = p_user_id;

  RETURN QUERY SELECT p_user_id, p_contact_id, v_mobile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_update_mobile(UUID, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.customer_update_mobile(UUID, UUID, TEXT) TO authenticated;
