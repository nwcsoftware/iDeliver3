-- ============================================================================
-- fix102 — customer registration requires an address (used as the default
--          address on every new order)
-- ----------------------------------------------------------------------------
-- The customer mobile sign-up form now asks for a mandatory address (+ optional
-- city). This replaces customer_contact_register_with_password with a version
-- that:
--   • rejects a blank address (ADDRESS_REQUIRED)
--   • stores it on contacts.address / contacts.city — the fallback the order
--     screens already use for pickup/delivery
--   • also writes it to contact_addresses as the customer's PRIMARY saved
--     address, so it is preselected in the address quick-pick
--
-- The old 7-argument function is dropped first: leaving both would make the
-- call ambiguous for PostgREST.
--
-- Safe to run multiple times.
-- ============================================================================

DROP FUNCTION IF EXISTS public.customer_contact_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.customer_contact_register_with_password(
  p_company_id   UUID,
  p_full_name    TEXT,
  p_mobile       TEXT,
  p_email        TEXT,
  p_username     TEXT,
  p_otp_channel  TEXT,
  p_password     TEXT,
  p_address      TEXT DEFAULT NULL,
  p_city         TEXT DEFAULT NULL
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
  v_address     TEXT := nullif(trim(coalesce(p_address, '')), '');
  v_city        TEXT := nullif(trim(coalesce(p_city, '')), '');
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_account_number TEXT;
  v_contact_id  UUID;
  v_address_id  UUID;
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

  -- The address is what every new order defaults to, so it can't be skipped.
  IF v_address IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_REQUIRED';
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
      address,
      city,
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
      v_address,
      v_city,
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
      address = COALESCE(NULLIF(c.address, ''), v_address),
      city = COALESCE(NULLIF(c.city, ''), v_city),
      updated_at = NOW()
    WHERE c.id = v_contact_id;
  END IF;

  -- Mirror it into the saved-address book as the primary entry, so the order
  -- screens preselect it. Only when the customer has no primary address yet.
  IF NOT EXISTS (
    SELECT 1 FROM public.contact_addresses AS a
    WHERE a.contact_id = v_contact_id AND a.is_primary IS TRUE
  ) THEN
    INSERT INTO public.contact_addresses (
      company_id, contact_id, address_name, address_line, city, is_primary
    )
    VALUES (
      p_company_id, v_contact_id, 'Home', v_address, v_city, TRUE
    )
    RETURNING id INTO v_address_id;
  END IF;

  RETURN QUERY SELECT * FROM public.customer_contact_session(v_contact_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_contact_register_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
