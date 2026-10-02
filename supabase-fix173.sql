-- ============================================================================
-- fix173 — partner subscriptions: 15 USD a year to the partner, 8 to the
--          super admin, and what the super admin is owed fixed for good
-- ----------------------------------------------------------------------------
-- The super admin's minimum was lowered to 8 USD a year. Decided:
--
--   * a partner subscription is sold at 15 USD a year — the admin's price is
--     set to 15, so every new partner login is opened at 15;
--   * the super admin is owed 8 for each;
--   * the office keeps 7.
--
-- WHAT THIS DOES
--   1. The partner minimum is 8 USD a year (it already is; set if not) and the
--      admin's price 15.
--   2. One-time correction of the existing partner subscriptions that are not
--      paid by the partner and not settled with the super admin (all 8 today):
--      sold at 15, the super admin owed 8. Free seats are untouched.
--   3. What a subscription owes the super admin is now FIXED WHEN IT IS
--      OPENED. fix172 recalculated it whenever an unsettled row's price or
--      dates were edited, at the minimum of that day; now an edit leaves it
--      alone, so changing the rates later never touches a subscription that
--      already exists. (Only the super admin's own correction,
--      super_admin_set_subscription_vendor, changes it.)
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. the rates ────────────────────────────────────────────────────────────
UPDATE public.subscription_price_floors
   SET amount = 8, updated_at = NOW()
 WHERE role = 'partner' AND amount IS DISTINCT FROM 8;

UPDATE public.subscription_price_floors
   SET sale_amount = 15, sale_updated_at = NOW()
 WHERE role = 'partner' AND sale_amount IS DISTINCT FROM 15;

-- ── 2. what is owed is fixed when a subscription is opened ──────────────────
-- fix172's rule with one change: the super admin's share is worked out on a
-- NEW row (or on an old row that never had one), and never again.
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

  -- What the super admin is owed: the minimum in force WHEN THE SUBSCRIPTION IS
  -- OPENED, for the years it covers, never more than its own price. Worked out
  -- once — on a new row, or an old row that has none yet — and then kept.
  IF NEW.subscription_role = 'partner' AND NOT v_vendor_write AND NEW.vendor_settled_at IS NULL
     AND (TG_OP = 'INSERT' OR (v_priced AND OLD.vendor_amount IS NULL)) THEN
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

-- ── 3. the one-time correction ──────────────────────────────────────────────
-- Unpaid, unsettled partner subscriptions: 15 to the partner, 8 to the super
-- admin (per year they cover). A partner who has already paid keeps the price
-- they paid; a settled one keeps what was settled. One block, so the switch
-- that lets it write the super admin's column lasts for it.
DO $$
BEGIN
  PERFORM set_config('app.subscription_vendor_write', 'on', true);
  UPDATE public.subscriptions s
     SET amount = 15 * GREATEST(1, ROUND(((s.end_date - s.start_date) + 1) / 365.0)),
         vendor_amount = 8 * GREATEST(1, ROUND(((s.end_date - s.start_date) + 1) / 365.0)),
         vendor_currency = 'USD',
         updated_at = NOW()
   WHERE s.subscription_role = 'partner'
     AND s.is_free_seat IS NOT TRUE
     AND s.is_paid IS NOT TRUE
     AND s.vendor_settled_at IS NULL
     AND COALESCE(s.currency, 'USD') = 'USD'
     AND (s.amount IS DISTINCT FROM 15 * GREATEST(1, ROUND(((s.end_date - s.start_date) + 1) / 365.0))
          OR s.vendor_amount IS DISTINCT FROM 8 * GREATEST(1, ROUND(((s.end_date - s.start_date) + 1) / 365.0)));
  PERFORM set_config('app.subscription_vendor_write', 'off', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: partner 8 USD a year / admin 15; every partner row sold 15, owed 8,
-- margin 7 (free seats 0 / 0 / 0); totals for the 8 rows: sold 120, owed 64,
-- margin 56.
SELECT 'rates' AS what, 'partner' AS who,
       'minimum ' || amount::TEXT || ' ' || currency || ' a ' || period || ' / admin ' || COALESCE(sale_amount::TEXT, 'not set') AS detail
  FROM public.subscription_price_floors WHERE role = 'partner'
UNION ALL
SELECT 'partner row', COALESCE(c.code, '?') || ' ' || COALESCE(NULLIF(c.company_name, ''), TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))),
       'sold ' || s.amount::TEXT || ' · owed ' || COALESCE(s.vendor_amount::TEXT, 'unknown')
       || ' · margin ' || COALESCE((s.amount - s.vendor_amount)::TEXT, '?')
       || CASE WHEN s.is_free_seat THEN ' · free seat' ELSE '' END
  FROM public.subscriptions s LEFT JOIN public.contacts c ON c.id = s.contact_id
 WHERE s.subscription_role = 'partner'
UNION ALL
SELECT 'totals', 'partner, not free',
       'sold ' || SUM(amount)::TEXT || ' · owed ' || SUM(vendor_amount)::TEXT || ' · margin ' || SUM(amount - vendor_amount)::TEXT
  FROM public.subscriptions
 WHERE subscription_role = 'partner' AND is_free_seat IS NOT TRUE;
