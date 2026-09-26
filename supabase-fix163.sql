-- ============================================================================
-- fix163 — free partner seats held for a year and assigned by hand; a login's
--          role decides its subscription; a contact's mobile is fixed
-- ----------------------------------------------------------------------------
-- 1. FREE PARTNER SEATS ARE RECORDS, NOT A RANKING.
--    Until now "free" meant "one of the first ten partners by creation date",
--    recomputed every time — so a seat moved the moment somebody older left,
--    was deactivated or retyped. A free seat is now a subscription row marked
--    is_free_seat: 0 USD, one year, held by the PARTNER (every partner login of
--    it gets its own free row for the same year). It stays theirs for the whole
--    year whatever happens to their logins. When the year ends the seat is
--    free again, and an administrator assigns it to a partner by hand.
--
--      seats in use  = partners holding an in-date free-seat row (max 10)
--      assign        assign_free_partner_seat(actor, contact) — admin or
--                    super admin; refuses an 11th seat and a second seat for
--                    the same partner, under a lock so two people assigning at
--                    once cannot both take the last one.
--
--    Existing "Included partner seat" rows are marked, and the two 90-day ones
--    (Madame Bougie, Shein koura) are extended to a full year.
--
-- 2. A LOGIN'S ROLE IS FIXED AND DECIDES ITS SUBSCRIPTION.
--    A contact that is both partner and supplier holds separate partner and
--    supplier logins (usernames are unique, so they can never be the same).
--    admin_create_party_login now takes the role; it must be one the contact
--    carries.
--
-- 3. A CONTACT'S MOBILE NUMBER IS FIXED ONCE SET.
--    A trigger refuses any change to contacts.mobile unless it comes through
--    super_admin_set_contact_mobile. It applies to customers, partners and
--    suppliers — drivers are left alone — and to the customer app as well,
--    whose own "change my mobile" is refused by the same trigger. A mobile that
--    is still empty may be filled in once, which is how registration works.
--
-- Run once. Safe to re-run.
-- ============================================================================

-- ── 1. free partner seats ───────────────────────────────────────────────────
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS is_free_seat BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.subscriptions.is_free_seat IS
  'A free partner seat (fix163): 0 USD for one year, held by the partner for its whole period, at most 10 in date at once.';

UPDATE public.subscriptions
   SET is_free_seat = TRUE
 WHERE is_free_seat = FALSE
   AND COALESCE(amount, 0) = 0
   AND description ILIKE 'Included partner seat%';

-- The seats issued for 90 days get their year.
UPDATE public.subscriptions
   SET end_date = start_date + 364, updated_at = NOW()
 WHERE is_free_seat
   AND end_date - start_date < 300;

CREATE INDEX IF NOT EXISTS idx_subscriptions_free_seat
  ON public.subscriptions (contact_id, start_date, end_date) WHERE is_free_seat;

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

  SELECT COUNT(DISTINCT contact_id) INTO v_in_use
    FROM subscriptions
   WHERE is_free_seat AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE;
  IF v_in_use >= 10 THEN RAISE EXCEPTION 'NO_FREE_SEAT'; END IF;

  -- Every partner login of this partner: its never-activated, unpaid charges are
  -- not owed any more, and it gets the free year.
  FOR v_login IN
    SELECT id FROM user_accounts WHERE contact_id = p_contact_id AND role::TEXT = 'partner'
  LOOP
    v_any := TRUE;
    DELETE FROM subscriptions
     WHERE user_account_id = v_login.id
       AND NOT is_free_seat AND is_paid IS NOT TRUE AND is_active IS NOT TRUE;
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
       AND NOT is_free_seat AND is_paid IS NOT TRUE AND is_active IS NOT TRUE;
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

-- ── 2. a login's role is chosen, and must be one the contact carries ────────
DROP FUNCTION IF EXISTS public.admin_create_party_login(UUID, UUID, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_create_party_login(
  p_actor_id   UUID,
  p_contact_id UUID,
  p_username   TEXT,
  p_email      TEXT,
  p_mobile     TEXT,
  p_password   TEXT,
  p_role       TEXT DEFAULT NULL
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
  v_role    TEXT := NULLIF(lower(trim(coalesce(p_role, ''))), '');
  v_id      UUID;
BEGIN
  v_actor := public._assert_login_creator(p_actor_id);

  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;
  IF v_contact.is_active IS FALSE THEN RAISE EXCEPTION 'CONTACT_INACTIVE'; END IF;

  v_types := COALESCE(NULLIF(v_contact.contact_types, '{}'), ARRAY[v_contact.contact_type::TEXT]);
  IF v_role IS NULL THEN
    -- Only unambiguous when the contact is one kind of party.
    IF 'partner' = ANY (v_types) AND 'supplier' = ANY (v_types) THEN RAISE EXCEPTION 'ROLE_REQUIRED'; END IF;
    v_role := CASE WHEN 'supplier' = ANY (v_types) THEN 'supplier'
                   WHEN 'partner'  = ANY (v_types) THEN 'partner' END;
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('partner', 'supplier') THEN RAISE EXCEPTION 'NOT_A_PARTY'; END IF;
  IF NOT (v_role = ANY (v_types)) THEN RAISE EXCEPTION 'ROLE_NOT_ON_CONTACT'; END IF;

  IF coalesce(trim(p_username), '') = '' THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF length(coalesce(p_password, '')) < 8 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;
  IF coalesce(trim(p_mobile), '') = '' THEN RAISE EXCEPTION 'MOBILE_REQUIRED'; END IF;

  INSERT INTO user_accounts (
    company_id, username, email, mobile, password_hash,
    role, status, contact_id, must_change_password, created_by
  )
  VALUES (
    v_actor.company_id, trim(p_username), NULLIF(trim(p_email), ''), trim(p_mobile),
    crypt(p_password, gen_salt('bf', 12)), v_role::user_role, 'active', p_contact_id, TRUE, p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO user_logbook (user_id, action, description)
  VALUES (v_id, 'ACCOUNT_CREATED',
          'Portal login (' || v_role || ') created from the profile by ' || v_actor.username
          || ' (' || v_actor.role::TEXT || ')');
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_create_party_login(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 3. a contact's mobile is fixed once set ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.contacts_mobile_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_types TEXT[] := COALESCE(NULLIF(OLD.contact_types, '{}'), ARRAY[OLD.contact_type::TEXT]);
BEGIN
  IF NEW.mobile IS NOT DISTINCT FROM OLD.mobile THEN RETURN NEW; END IF;
  -- A number not yet given may be filled in once.
  IF OLD.mobile IS NULL OR trim(OLD.mobile) = '' THEN RETURN NEW; END IF;
  -- Drivers keep their own rules: their numbers are managed on the Drivers page.
  IF v_types <@ ARRAY['driver']::TEXT[] THEN RETURN NEW; END IF;
  -- The super admin's own function says so for the length of its transaction.
  IF coalesce(current_setting('app.mobile_change_ok', true), '') = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'MOBILE_LOCKED';
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_mobile_lock ON public.contacts;
CREATE TRIGGER trg_contacts_mobile_lock
  BEFORE UPDATE OF mobile ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_mobile_lock();

CREATE OR REPLACE FUNCTION public.super_admin_set_contact_mobile(p_actor_id UUID, p_contact_id UUID, p_mobile TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);
  IF coalesce(trim(p_mobile), '') = '' THEN RAISE EXCEPTION 'MOBILE_REQUIRED'; END IF;
  PERFORM set_config('app.mobile_change_ok', 'on', true);   -- this transaction only
  UPDATE contacts SET mobile = trim(p_mobile), updated_at = NOW() WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_set_contact_mobile(UUID, UUID, TEXT) TO anon, authenticated;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect free_seats_in_use = 10, shortest_free_year = 364 (no 90-day seat left),
-- mobile_lock_on = 1, functions_present = 3.

SELECT
  (SELECT COUNT(DISTINCT contact_id) FROM public.subscriptions
    WHERE is_free_seat AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)     AS free_seats_in_use,
  (SELECT MIN(end_date - start_date) FROM public.subscriptions WHERE is_free_seat)       AS shortest_free_year,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_contacts_mobile_lock')            AS mobile_lock_on,
  (SELECT COUNT(*) FROM pg_proc
    WHERE proname IN ('assign_free_partner_seat', 'admin_create_party_login',
                      'super_admin_set_contact_mobile'))                                 AS functions_present;

NOTIFY pgrst, 'reload schema';
