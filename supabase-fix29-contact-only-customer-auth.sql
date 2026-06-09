-- fix29: Customer mobile auth must use contacts only.
-- This removes the old customer-mobile dependency on user_accounts by ensuring
-- both the current and legacy registration RPC names write username/password_hash
-- to contacts. Run this in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_customer_username
  ON public.contacts (lower(username))
  WHERE contact_type = 'customer' AND username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_customer_email
  ON public.contacts (lower(email))
  WHERE contact_type = 'customer' AND email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.customer_contact_session(p_contact_id UUID)
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NULL::UUID AS user_id,
    COALESCE(c.username, c.email, c.mobile)::TEXT AS username,
    c.email::TEXT,
    c.mobile::TEXT,
    'customer'::user_role AS role,
    CASE WHEN COALESCE(c.is_active, TRUE) THEN 'active'::user_status ELSE 'suspended'::user_status END AS status,
    c.company_id,
    c.branch_id,
    c.id AS contact_id,
    '{}'::JSONB AS permissions,
    c.first_name::TEXT,
    c.last_name::TEXT
  FROM public.contacts AS c
  WHERE c.id = p_contact_id
    AND c.contact_type = 'customer'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.customer_contact_login(
  p_login    TEXT,
  p_password TEXT
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
  v_login TEXT := lower(trim(coalesce(p_login, '')));
  v_contact public.contacts%ROWTYPE;
BEGIN
  IF v_login = '' OR coalesce(p_password, '') = '' THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  SELECT *
  INTO v_contact
  FROM public.contacts AS c
  WHERE c.contact_type = 'customer'
    AND (
      lower(coalesce(c.username, '')) = v_login
      OR lower(coalesce(c.email, '')) = v_login
      OR coalesce(c.mobile, '') = trim(p_login)
    )
  LIMIT 1;

  IF v_contact.id IS NULL
     OR COALESCE(v_contact.is_active, TRUE) = FALSE
     OR coalesce(v_contact.password_hash, '') = ''
     OR (
       crypt(p_password, v_contact.password_hash) != v_contact.password_hash
       AND v_contact.password_hash != p_password
     ) THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS';
  END IF;

  IF v_contact.password_hash = p_password THEN
    UPDATE public.contacts
    SET password_hash = crypt(p_password, gen_salt('bf', 12)),
        updated_at = NOW()
    WHERE id = v_contact.id;
  END IF;

  RETURN QUERY SELECT * FROM public.customer_contact_session(v_contact.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_contact_register_with_password(
  p_company_id   UUID,
  p_full_name    TEXT,
  p_mobile       TEXT,
  p_email        TEXT,
  p_username     TEXT,
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
  v_mobile      TEXT := trim(coalesce(p_mobile, ''));
  v_email       TEXT := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_username    TEXT := nullif(lower(trim(coalesce(p_username, ''))), '');
  v_otp_channel TEXT := lower(trim(coalesce(p_otp_channel, 'whatsapp')));
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_account_number TEXT;
  v_contact_id  UUID;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_REQUIRED';
  END IF;
  IF coalesce(trim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED';
  END IF;
  IF v_mobile = '' THEN
    RAISE EXCEPTION 'MOBILE_REQUIRED';
  END IF;
  IF v_username IS NULL THEN
    v_username := COALESCE(v_email, v_mobile);
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

  SELECT c.id
  INTO v_contact_id
  FROM public.contacts AS c
  WHERE c.contact_type = 'customer'
    AND (
      lower(coalesce(c.username, '')) = v_username
      OR coalesce(c.mobile, '') = v_mobile
      OR (v_email IS NOT NULL AND lower(coalesce(c.email, '')) = v_email)
    )
  LIMIT 1;

  v_first_name := split_part(trim(p_full_name), ' ', 1);
  v_last_name := nullif(trim(substr(trim(p_full_name), length(v_first_name) + 1)), '');

  IF v_contact_id IS NULL THEN
    SELECT lpad(
      (
        COALESCE(MAX(NULLIF(regexp_replace(c.account_number, '\D', '', 'g'), '')::BIGINT), 0) + 1
      )::TEXT,
      12,
      '0'
    )
    INTO v_account_number
    FROM public.contacts AS c
    WHERE c.contact_type = 'customer';

    INSERT INTO public.contacts (
      company_id,
      contact_type,
      account_number,
      username,
      password_hash,
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
      v_username,
      crypt(p_password, gen_salt('bf', 12)),
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
    IF EXISTS (
      SELECT 1
      FROM public.contacts AS c
      WHERE c.id = v_contact_id
        AND coalesce(c.password_hash, '') <> ''
    ) THEN
      RAISE EXCEPTION 'CUSTOMER_ALREADY_EXISTS';
    END IF;

    UPDATE public.contacts AS c
    SET
      username = COALESCE(c.username, v_username),
      password_hash = crypt(p_password, gen_salt('bf', 12)),
      email = COALESCE(c.email, v_email),
      mobile = COALESCE(NULLIF(c.mobile, ''), v_mobile),
      whatsapp_number = COALESCE(c.whatsapp_number, v_mobile),
      updated_at = NOW()
    WHERE c.id = v_contact_id;
  END IF;

  RETURN QUERY SELECT * FROM public.customer_contact_session(v_contact_id);
END;
$$;

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.customer_contact_register_with_password(
    p_company_id,
    p_full_name,
    p_mobile,
    p_email,
    COALESCE(NULLIF(lower(trim(p_email)), ''), NULLIF(trim(p_mobile), '')),
    p_otp_channel,
    p_password
  );
$$;

GRANT EXECUTE ON FUNCTION public.customer_contact_session(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_contact_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_contact_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
