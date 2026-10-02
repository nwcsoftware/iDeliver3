-- ============================================================================
-- fix174 — seat prices and free seats set by the super admin; an admin may add
--          call-centre and Senior Call Center accounts
-- ----------------------------------------------------------------------------
-- The seats inside the annual package — how many are free, and what one more
-- costs a year — were constants in the code (billing.js): call centre 6 free,
-- administrators 4, drivers 15, partners 10; 15 USD a year beyond. Now:
--
--   seat_settings          one row per kind (call_center, admin, driver,
--                          partner): free seats and the yearly price of each
--                          seat beyond them. Read by everyone; written only
--                          through super_admin_set_seat(). Starts at today's
--                          numbers, so nothing changes until the super admin
--                          changes them. (A partner's PRICE stays the partner
--                          minimum in subscription_price_floors; only its free
--                          seats are here.)
--
--   admin_create_staff_login()   an ADMIN (or the super admin) creates a
--                          call-centre or Senior Call Center login — no
--                          contact, nothing else. Every other login stays the
--                          super admin's (admin_create_user). A seat beyond the
--                          free ones is charged by the application at the price
--                          above, once the admin has accepted it.
--
--   assign_free_partner_seat()   reads the number of free partner seats from
--                          seat_settings instead of a fixed 10.
--
-- SENIOR CALL CENTER now counts among the CALL-CENTRE seats (decided 2 Oct
-- 2026, reversing fix156): same free seats, same price. Administrators then
-- hold 4 of their 4, so the unpaid "Administrators seat 5" charge is no longer
-- owed and is removed (only while it is unpaid, and only if administrators are
-- within their free seats).
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. the seats ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seat_settings (
  family      TEXT PRIMARY KEY CHECK (family IN ('call_center', 'admin', 'driver', 'partner')),
  included    INTEGER NOT NULL CHECK (included >= 0),
  extra_rate  NUMERIC NOT NULL CHECK (extra_rate >= 0),
  currency    TEXT NOT NULL DEFAULT 'USD',
  period      TEXT NOT NULL DEFAULT 'year' CHECK (period = 'year'),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID
);

INSERT INTO public.seat_settings (family, included, extra_rate) VALUES
  ('call_center', 6, 15), ('admin', 4, 15), ('driver', 15, 15), ('partner', 10, 0)
ON CONFLICT (family) DO NOTHING;

ALTER TABLE public.seat_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_seat_settings" ON public.seat_settings;
CREATE POLICY "anon_read_seat_settings"
  ON public.seat_settings FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.super_admin_set_seat(p_actor_id UUID, p_family TEXT, p_included INTEGER, p_rate NUMERIC)
RETURNS public.seat_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.seat_settings%ROWTYPE;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);
  IF p_family NOT IN ('call_center', 'admin', 'driver', 'partner') THEN RAISE EXCEPTION 'BAD_FAMILY'; END IF;
  IF p_included IS NULL OR p_included < 0 THEN RAISE EXCEPTION 'INCLUDED_REQUIRED'; END IF;
  IF p_family <> 'partner' AND (p_rate IS NULL OR p_rate <= 0) THEN RAISE EXCEPTION 'PRICE_REQUIRED'; END IF;
  UPDATE public.seat_settings
     SET included   = p_included,
         -- A partner's price is the partner minimum, set on its own.
         extra_rate = CASE WHEN p_family = 'partner' THEN extra_rate ELSE ROUND(p_rate, 2) END,
         updated_at = NOW(), updated_by = p_actor_id
   WHERE family = p_family
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_set_seat(UUID, TEXT, INTEGER, NUMERIC) TO anon, authenticated;

-- ── 2. an admin creates call-centre and Senior Call Center logins ───────────
CREATE OR REPLACE FUNCTION public.admin_create_staff_login(
  p_actor_id UUID, p_username TEXT, p_email TEXT, p_mobile TEXT, p_password TEXT, p_role TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor user_accounts%ROWTYPE;
  v_id    UUID;
BEGIN
  v_actor := public._assert_admin(p_actor_id);        -- admin or super admin; not Senior Call Center
  IF p_role NOT IN ('call_center', 'senior_call_center') THEN RAISE EXCEPTION 'STAFF_ROLE_ONLY'; END IF;
  IF coalesce(trim(p_username), '') = '' THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF coalesce(trim(p_mobile), '') = '' THEN RAISE EXCEPTION 'MOBILE_REQUIRED'; END IF;
  IF length(coalesce(p_password, '')) < 8 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  INSERT INTO user_accounts (
    company_id, username, email, mobile, password_hash,
    role, status, contact_id, must_change_password, created_by
  )
  VALUES (
    v_actor.company_id, trim(p_username), NULLIF(trim(p_email), ''), trim(p_mobile),
    crypt(p_password, gen_salt('bf', 12)), p_role::user_role, 'active',
    NULL, TRUE, p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED', 'Account created by ' || v_actor.username);
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_staff_login(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 3. free partner seats: the number comes from the settings ───────────────
-- fix172's function, with the fixed 10 replaced by seat_settings.
CREATE OR REPLACE FUNCTION public.assign_free_partner_seat(p_actor_id UUID, p_contact_id UUID)
RETURNS DATE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   user_accounts%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_types   TEXT[];
  v_in_use  INT;
  v_limit   INT;
  v_start   DATE := CURRENT_DATE;
  v_end     DATE := CURRENT_DATE + 364;
  v_login   RECORD;
  v_any     BOOLEAN := FALSE;
BEGIN
  v_actor := public._assert_admin(p_actor_id);

  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;
  IF v_contact.is_active IS FALSE THEN RAISE EXCEPTION 'CONTACT_INACTIVE'; END IF;
  v_types := COALESCE(NULLIF(v_contact.contact_types, '{}'), ARRAY[v_contact.contact_type::TEXT]);
  IF NOT ('partner' = ANY (v_types)) THEN RAISE EXCEPTION 'NOT_A_PARTNER'; END IF;

  -- One at a time: two people assigning the last seat together must not both get it.
  PERFORM pg_advisory_xact_lock(hashtext('assign_free_partner_seat'));

  IF EXISTS (SELECT 1 FROM subscriptions
              WHERE contact_id = p_contact_id AND is_free_seat
                AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE) THEN
    RAISE EXCEPTION 'ALREADY_HOLDS_SEAT';
  END IF;

  SELECT COALESCE((SELECT included FROM public.seat_settings WHERE family = 'partner'), 10) INTO v_limit;
  SELECT COUNT(DISTINCT contact_id) INTO v_in_use
    FROM subscriptions
   WHERE is_free_seat AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE;
  IF v_in_use >= v_limit THEN RAISE EXCEPTION 'NO_FREE_SEAT'; END IF;

  -- Every partner login of this partner: its unpaid, unsettled charges are not
  -- owed any more, and it gets the free year.
  FOR v_login IN
    SELECT id FROM user_accounts WHERE contact_id = p_contact_id AND role::TEXT = 'partner'
  LOOP
    v_any := TRUE;
    DELETE FROM subscriptions
     WHERE user_account_id = v_login.id
       AND NOT is_free_seat AND is_paid IS NOT TRUE AND vendor_settled_at IS NULL;
    INSERT INTO subscriptions (company_id, contact_id, user_account_id, description, start_date, end_date,
                               amount, currency, is_paid, paid_at, paid_by_note, is_active, is_free_seat,
                               created_by)
    VALUES (v_contact.company_id, p_contact_id, v_login.id,
            'Included partner seat — inside the annual package (A5A)', v_start, v_end,
            0, 'USD', TRUE, NOW(), 'Free partner seat assigned by ' || v_actor.username, TRUE, TRUE,
            p_actor_id);
  END LOOP;

  -- No partner login yet: the seat waits on the contact for the first one.
  IF NOT v_any THEN
    DELETE FROM subscriptions
     WHERE contact_id = p_contact_id AND user_account_id IS NULL
       AND NOT is_free_seat AND is_paid IS NOT TRUE AND vendor_settled_at IS NULL;
    INSERT INTO subscriptions (company_id, contact_id, description, start_date, end_date, amount, currency,
                               is_paid, paid_at, paid_by_note, is_active, is_free_seat, created_by)
    VALUES (v_contact.company_id, p_contact_id, 'Included partner seat — inside the annual package (A5A)',
            v_start, v_end, 0, 'USD', TRUE, NOW(), 'Free partner seat assigned by ' || v_actor.username,
            TRUE, TRUE, p_actor_id);
  END IF;

  RETURN v_end;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assign_free_partner_seat(UUID, UUID) TO anon, authenticated;

-- ── 4. the administrator seat charge that is no longer owed ─────────────────
-- With Senior Call Center counted among the call-centre seats, administrators
-- are within their free seats; an unpaid, switched-off charge for an
-- administrator seat beyond them is not owed. Removed only while that is true.
DELETE FROM public.subscriptions s
 WHERE s.contact_id IS NULL
   AND s.description ILIKE 'Administrators seat %'
   AND s.is_paid IS NOT TRUE AND s.is_active IS NOT TRUE
   AND (SELECT COUNT(*) FROM public.user_accounts WHERE role::TEXT = 'admin' AND status::TEXT = 'active')
       <= (SELECT included FROM public.seat_settings WHERE family = 'admin');

NOTIFY pgrst, 'reload schema';

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: call_center 6 free / 15 USD, admin 4 / 15, driver 15 / 15, partner
-- 10 free; active logins — admin 4 (within 4), call centre + senior 3 (within
-- 6); no "Administrators seat" charge left; the three functions installed.
SELECT 'seats' AS what, family AS who,
       included::TEXT || ' free · ' || CASE WHEN family = 'partner' THEN 'price = partner minimum'
                                            ELSE extra_rate::TEXT || ' ' || currency || ' a year beyond' END AS detail
  FROM public.seat_settings
UNION ALL
SELECT 'active logins', 'admin', COUNT(*)::TEXT FROM public.user_accounts WHERE role::TEXT = 'admin' AND status::TEXT = 'active'
UNION ALL
SELECT 'active logins', 'call centre + senior', COUNT(*)::TEXT FROM public.user_accounts
 WHERE role::TEXT IN ('call_center', 'senior_call_center') AND status::TEXT = 'active'
UNION ALL
SELECT 'admin seat charges left', '', COUNT(*)::TEXT FROM public.subscriptions
 WHERE contact_id IS NULL AND description ILIKE 'Administrators seat %'
UNION ALL
SELECT 'installed', p.proname::TEXT, 'yes' FROM pg_proc p
 WHERE p.proname IN ('super_admin_set_seat', 'admin_create_staff_login', 'assign_free_partner_seat');
