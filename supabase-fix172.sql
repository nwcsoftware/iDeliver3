-- ============================================================================
-- fix172 — partner subscriptions: the admin's price, and what the super admin
--          is owed for each one
-- ----------------------------------------------------------------------------
-- Until now a partner's subscription waited, unpaid and switched off, until the
-- super admin recorded a payment — so a new partner could not sign in. The
-- arrangement is now two separate accounts:
--
--   partner  ──pays──▶  admin (the office)       at the ADMIN's price
--   admin    ──pays──▶  super admin               the super admin's MINIMUM
--
-- The admin may sell at the minimum (keeping nothing) or above it (keeping the
-- difference); the super admin is owed the minimum either way.
--
-- WHAT THIS ADDS
--   subscription_price_floors.sale_amount   the admin's partner price, per year.
--       Written only through admin_set_subscription_price() — admin or super
--       admin, never below the minimum. Every subscription opened with a new
--       partner login is priced from it (the application reads it).
--   subscriptions.vendor_amount / vendor_currency
--       what the super admin is owed for a PARTNER row: the minimum in force
--       when the row was priced, times the years it covers — never more than the
--       row's own price (a super admin's 0-priced exception owes nothing). A
--       free seat owes 0. Filled by the database, not by the page.
--   subscriptions.vendor_settled_at / _by / vendor_reference
--       the admin has paid the super admin for this row. Written only through
--       super_admin_settle_subscriptions().
--
--   The trigger refuses any other change to those five columns: they are the
--   super admin's account, and the ordinary save cannot touch them.
--   assign_free_partner_seat() now cancels an unpaid charge even when it is
--   switched on (as every new one is) — see section 5.
--
-- EXISTING ROWS: each partner row is given the minimum in force when it was
-- created — 10 USD a year before the super admin last changed the minimum
-- (subscription_price_floors.updated_at), today's minimum after. The check at
-- the end lists every row so a wrong one can be corrected with
-- super_admin_set_subscription_vendor(). Nothing is marked settled.
-- Rows that are switched off stay switched off.
--
-- Suppliers are not part of this (their rows get no vendor amount).
-- Safe to re-run.
-- ============================================================================

-- ── 1. the admin's price ────────────────────────────────────────────────────
ALTER TABLE public.subscription_price_floors ADD COLUMN IF NOT EXISTS sale_amount     NUMERIC;
ALTER TABLE public.subscription_price_floors ADD COLUMN IF NOT EXISTS sale_updated_at TIMESTAMPTZ;
ALTER TABLE public.subscription_price_floors ADD COLUMN IF NOT EXISTS sale_updated_by UUID;

CREATE OR REPLACE FUNCTION public.admin_set_subscription_price(p_actor_id UUID, p_role TEXT, p_amount NUMERIC)
RETURNS public.subscription_price_floors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_floor public.subscription_price_floors%ROWTYPE;
  v_row   public.subscription_price_floors%ROWTYPE;
BEGIN
  PERFORM public._assert_admin(p_actor_id);           -- admin or super admin; not Senior Call Center
  IF p_role IS DISTINCT FROM 'partner' THEN RAISE EXCEPTION 'BAD_ROLE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED'; END IF;
  SELECT * INTO v_floor FROM public.subscription_price_floors WHERE role = p_role FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_MINIMUM'; END IF;
  IF ROUND(p_amount, 2) < v_floor.amount THEN
    RAISE EXCEPTION 'PRICE_BELOW_MINIMUM: % % is below the minimum of % % a %',
      ROUND(p_amount, 2), v_floor.currency, v_floor.amount, v_floor.currency, v_floor.period;
  END IF;
  UPDATE public.subscription_price_floors
     SET sale_amount = ROUND(p_amount, 2), sale_updated_at = NOW(), sale_updated_by = p_actor_id
   WHERE role = p_role
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription_price(UUID, TEXT, NUMERIC) TO anon, authenticated;

-- ── 2. what the super admin is owed, per subscription ───────────────────────
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS vendor_amount     NUMERIC;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS vendor_currency   TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS vendor_settled_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS vendor_settled_by TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS vendor_reference  TEXT;

-- ── 3. the rule, extended (replaces fix169's) ───────────────────────────────
-- Unchanged from fix169: the kind is filled in, a supplier trial is recognised,
-- and a price under the minimum is refused. New: the five vendor columns are
-- written only under the super admin's functions (which switch
-- app.subscription_vendor_write on for their own transaction), and a partner
-- row's vendor_amount is worked out here whenever its price is set.
CREATE OR REPLACE FUNCTION public._subscriptions_price_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_floor     public.subscription_price_floors%ROWTYPE;
  v_has_floor BOOLEAN;
  v_units     NUMERIC;
  v_min       NUMERIC;
  v_vendor_write BOOLEAN := COALESCE(current_setting('app.subscription_vendor_write', true), '') = 'on';
  v_priced    BOOLEAN;
BEGIN
  IF NEW.subscription_role IS NULL THEN
    NEW.subscription_role := public._subscription_role_of(NEW.user_account_id, NEW.contact_id, NEW.is_free_seat, NEW.description);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_free_seat IS NOT TRUE AND COALESCE(NEW.amount, 0) = 0
     AND NEW.description ~* '^Free [0-9]+-day introductory' THEN
    NEW.is_trial := TRUE;
  END IF;

  -- The super admin's account is not the page's to write.
  IF NOT v_vendor_write THEN
    IF TG_OP = 'INSERT' THEN
      NEW.vendor_amount := NULL; NEW.vendor_currency := NULL;
      NEW.vendor_settled_at := NULL; NEW.vendor_settled_by := NULL; NEW.vendor_reference := NULL;
    ELSIF NEW.vendor_amount     IS DISTINCT FROM OLD.vendor_amount
       OR NEW.vendor_currency   IS DISTINCT FROM OLD.vendor_currency
       OR NEW.vendor_settled_at IS DISTINCT FROM OLD.vendor_settled_at
       OR NEW.vendor_settled_by IS DISTINCT FROM OLD.vendor_settled_by
       OR NEW.vendor_reference  IS DISTINCT FROM OLD.vendor_reference THEN
      RAISE EXCEPTION 'VENDOR_LOCKED: what is owed to the super admin is changed only by the super admin';
    END IF;
  END IF;

  v_priced := TG_OP = 'INSERT'
           OR NEW.amount     IS DISTINCT FROM OLD.amount
           OR NEW.start_date IS DISTINCT FROM OLD.start_date
           OR NEW.end_date   IS DISTINCT FROM OLD.end_date
           OR NEW.currency   IS DISTINCT FROM OLD.currency;

  SELECT * INTO v_floor FROM public.subscription_price_floors WHERE role = NEW.subscription_role;
  v_has_floor := FOUND;

  -- What the super admin is owed: the minimum now in force for the years it
  -- covers, never more than the row's own price. A settled row keeps what it
  -- was settled at. Another currency than the minimum's cannot be compared —
  -- left unknown rather than guessed.
  IF NEW.subscription_role = 'partner' AND v_priced AND NOT v_vendor_write AND NEW.vendor_settled_at IS NULL THEN
    IF NEW.is_free_seat IS TRUE OR NEW.is_trial IS TRUE THEN
      NEW.vendor_amount := 0; NEW.vendor_currency := COALESCE(NEW.currency, 'USD');
    ELSIF v_has_floor AND COALESCE(NEW.currency, 'USD') = v_floor.currency THEN
      v_units := GREATEST(1, ROUND(((NEW.end_date - NEW.start_date) + 1)
                                   / CASE v_floor.period WHEN 'year' THEN 365.0 ELSE 30.4375 END));
      NEW.vendor_amount := LEAST(COALESCE(NEW.amount, 0), v_floor.amount * v_units);
      NEW.vendor_currency := v_floor.currency;
    ELSE
      NEW.vendor_amount := NULL; NEW.vendor_currency := NULL;
    END IF;
  END IF;

  -- fix169's rule, as it was.
  IF NEW.is_free_seat IS TRUE OR NEW.is_trial IS TRUE THEN RETURN NEW; END IF;
  IF NOT v_priced THEN RETURN NEW; END IF;
  IF NEW.subscription_role IS NULL THEN RETURN NEW; END IF;
  IF NEW.priced_by IS NOT NULL AND EXISTS (
       SELECT 1 FROM user_accounts WHERE id = NEW.priced_by AND role::TEXT = 'super_admin' AND status = 'active') THEN
    RETURN NEW;
  END IF;
  IF NOT v_has_floor THEN RETURN NEW; END IF;

  IF COALESCE(NEW.currency, 'USD') <> v_floor.currency THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CURRENCY: a % subscription is priced in %, not %',
      NEW.subscription_role, v_floor.currency, COALESCE(NEW.currency, '(none)');
  END IF;

  v_units := GREATEST(1, ROUND(((NEW.end_date - NEW.start_date) + 1)
                               / CASE v_floor.period WHEN 'year' THEN 365.0 ELSE 30.4375 END));
  v_min := v_floor.amount * v_units;
  IF NEW.amount IS NULL OR NEW.amount < v_min THEN
    RAISE EXCEPTION 'PRICE_BELOW_MINIMUM: % % is below the minimum of % % for this % subscription',
      COALESCE(NEW.amount, 0), v_floor.currency, v_min, v_floor.currency, NEW.subscription_role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_price_floor ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_price_floor
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public._subscriptions_price_floor();

-- ── 4. the super admin's functions ──────────────────────────────────────────
-- Record (or undo) that the admin has paid the super admin for these rows.
CREATE OR REPLACE FUNCTION public.super_admin_settle_subscriptions(
  p_actor_id UUID, p_ids UUID[], p_settled BOOLEAN, p_settled_on DATE, p_reference TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.user_accounts%ROWTYPE;
  v_name  TEXT;
  v_n     INTEGER;
BEGIN
  v_actor := public._assert_super_admin(p_actor_id);
  IF p_settled AND NULLIF(TRIM(COALESCE(p_reference, '')), '') IS NULL THEN RAISE EXCEPTION 'REFERENCE_REQUIRED'; END IF;
  v_name := v_actor.username;                          -- user_accounts holds no first/last name
  PERFORM set_config('app.subscription_vendor_write', 'on', true);
  UPDATE public.subscriptions
     SET vendor_settled_at = CASE WHEN p_settled THEN (COALESCE(p_settled_on, CURRENT_DATE) + TIME '12:00')::TIMESTAMPTZ END,
         vendor_settled_by = CASE WHEN p_settled THEN v_name END,
         vendor_reference  = CASE WHEN p_settled THEN TRIM(p_reference) END,
         updated_at = NOW()
   WHERE id = ANY (p_ids) AND subscription_role = 'partner';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.subscription_vendor_write', 'off', true);
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_settle_subscriptions(UUID, UUID[], BOOLEAN, DATE, TEXT) TO anon, authenticated;

-- Correct what one row owes the super admin.
CREATE OR REPLACE FUNCTION public.super_admin_set_subscription_vendor(p_actor_id UUID, p_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_amount NUMERIC;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'AMOUNT_REQUIRED'; END IF;
  PERFORM set_config('app.subscription_vendor_write', 'on', true);
  UPDATE public.subscriptions
     SET vendor_amount = ROUND(p_amount, 2), vendor_currency = COALESCE(vendor_currency, currency, 'USD'), updated_at = NOW()
   WHERE id = p_id AND subscription_role = 'partner'
  RETURNING vendor_amount INTO v_amount;
  PERFORM set_config('app.subscription_vendor_write', 'off', true);
  IF v_amount IS NULL THEN RAISE EXCEPTION 'NOT_A_PARTNER_SUBSCRIPTION'; END IF;
  RETURN v_amount;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_set_subscription_vendor(UUID, UUID, NUMERIC) TO anon, authenticated;

-- ── 5. a free seat cancels the charge it replaces ───────────────────────────
-- fix163's function, with one change. It cancelled a partner's charges that
-- were "never activated, unpaid" — but a partner's subscription is now switched
-- on from the day the login is made, so it would have cancelled nothing and the
-- partner would hold a free seat AND a bill. It now cancels every UNPAID charge
-- the office has not already settled with the super admin, switched on or not.
-- A charge the partner has paid, or one already settled, is left as it is.
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

-- ── 6. existing partner rows ────────────────────────────────────────────────
-- One block, so the switch that lets it write the vendor columns lasts for it.
DO $$
BEGIN
  PERFORM set_config('app.subscription_vendor_write', 'on', true);
  UPDATE public.subscriptions s
     SET vendor_amount = CASE
           WHEN s.is_free_seat IS TRUE OR s.is_trial IS TRUE THEN 0
           WHEN COALESCE(s.currency, 'USD') <> f.currency THEN NULL
           ELSE LEAST(COALESCE(s.amount, 0),
                      (CASE WHEN f.updated_by IS NOT NULL AND s.created_at < f.updated_at THEN 10 ELSE f.amount END)
                      * GREATEST(1, ROUND(((s.end_date - s.start_date) + 1) / 365.0)))
         END,
         vendor_currency = CASE WHEN COALESCE(s.currency, 'USD') = f.currency OR s.is_free_seat IS TRUE OR s.is_trial IS TRUE
                                THEN COALESCE(s.currency, 'USD') END
    FROM public.subscription_price_floors f
   WHERE f.role = 'partner'
     AND s.subscription_role = 'partner'
     AND s.vendor_amount IS NULL
     AND s.vendor_settled_at IS NULL;
  PERFORM set_config('app.subscription_vendor_write', 'off', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: the partner minimum (15 USD a year today) with no admin price yet;
-- one line per partner subscription with what it is sold at and what the super
-- admin is owed (10 for rows made before the minimum was raised, 15 after,
-- 0 for free seats); every function and the trigger installed.
SELECT 'minimum / admin price' AS what, role AS who,
       amount::TEXT || ' ' || currency || ' a ' || period || ' / admin: '
       || COALESCE(sale_amount::TEXT || ' ' || currency, 'not set yet') AS detail
  FROM public.subscription_price_floors WHERE role = 'partner'
UNION ALL
SELECT 'partner row', COALESCE(c.code, '?') || ' ' || COALESCE(NULLIF(c.company_name, ''), TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))),
       'sold ' || COALESCE(s.amount::TEXT, '?') || ' ' || COALESCE(s.currency, '') || ' · owed to super admin '
       || COALESCE(s.vendor_amount::TEXT || ' ' || COALESCE(s.vendor_currency, ''), 'unknown')
       || ' · made ' || TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI')
       || CASE WHEN s.is_free_seat THEN ' · free seat' ELSE '' END
       || CASE WHEN s.is_active THEN ' · on' ELSE ' · off' END
  FROM public.subscriptions s LEFT JOIN public.contacts c ON c.id = s.contact_id
 WHERE s.subscription_role = 'partner'
UNION ALL
SELECT 'installed', p.proname::TEXT, 'yes'
  FROM pg_proc p
 WHERE p.proname IN ('admin_set_subscription_price', 'super_admin_settle_subscriptions', 'super_admin_set_subscription_vendor',
                     'assign_free_partner_seat')
UNION ALL
SELECT 'trigger', 'trg_subscriptions_price_floor',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_subscriptions_price_floor') THEN 'installed' ELSE 'MISSING' END;
