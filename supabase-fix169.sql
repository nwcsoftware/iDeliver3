-- ============================================================================
-- fix169 — subscription prices have a floor the super admin sets
-- ----------------------------------------------------------------------------
-- Partner and supplier subscriptions were priced by constants in the code (a
-- partner seat USD 10 a year, the Basic supplier plan USD 10 a month). Now:
--
--   * the SUPER ADMIN sets the minimum price — partner per year, supplier per
--     month — in App Settings;
--   * an ADMIN prices each subscription by hand, at or above that minimum;
--   * nobody below the super admin can save one at 0, empty, or under it.
--
-- WHAT THIS ADDS
--   subscription_price_floors      one row per kind (partner / supplier): the
--                                  minimum, its currency and its period. Read by
--                                  everyone; written ONLY through
--                                  super_admin_set_subscription_floor().
--   subscriptions.subscription_role  'partner' or 'supplier' — what the row is
--                                  for. Filled from the login's role, or for a
--                                  row with no login yet, from what it says.
--   subscriptions.is_trial         the free introductory period a supplier login
--                                  starts on. Free by design, like a free seat.
--   subscriptions.priced_by        who last set the price (the application sends
--                                  it on every save).
--
-- THE RULE (trigger trg_subscriptions_price_floor), on every new row and every
-- change to a row's price, dates or currency:
--     amount >= minimum × the number of periods it covers
--   (a one-year partner row = 1 year; a three-month supplier row = 3 months).
--   Not checked: a free partner seat, a supplier's free trial, a row the super
--   admin priced (his exceptions — e.g. the 0-priced "System Reserve"), and a
--   row whose kind cannot be told. A row that is only paid, activated or
--   renamed is not re-checked, so today's rows keep working whatever they cost.
--   A subscription in another currency than its minimum is refused: the two
--   cannot be compared, and this application never converts.
--
-- The minimums start at today's prices — partner USD 10 a year, supplier USD
-- 10 a month — so nothing changes until the super admin changes them.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. the minimums ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_price_floors (
  role        TEXT PRIMARY KEY CHECK (role IN ('partner', 'supplier')),
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL DEFAULT 'USD',
  period      TEXT NOT NULL CHECK (period IN ('year', 'month')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID
);

INSERT INTO public.subscription_price_floors (role, amount, currency, period)
VALUES ('partner', 10, 'USD', 'year'), ('supplier', 10, 'USD', 'month')
ON CONFLICT (role) DO NOTHING;

-- Everyone may READ the minimums; nobody writes them except through the
-- function below (there is deliberately no insert/update policy).
ALTER TABLE public.subscription_price_floors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_subscription_price_floors" ON public.subscription_price_floors;
CREATE POLICY "anon_read_subscription_price_floors"
  ON public.subscription_price_floors FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.super_admin_set_subscription_floor(p_actor_id UUID, p_role TEXT, p_amount NUMERIC)
RETURNS public.subscription_price_floors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.subscription_price_floors%ROWTYPE;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);
  IF p_role NOT IN ('partner', 'supplier') THEN RAISE EXCEPTION 'BAD_ROLE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED'; END IF;
  UPDATE public.subscription_price_floors
     SET amount = ROUND(p_amount, 2), updated_at = NOW(), updated_by = p_actor_id
   WHERE role = p_role
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_set_subscription_floor(UUID, TEXT, NUMERIC) TO anon, authenticated;

-- ── 2. what each subscription is for ────────────────────────────────────────
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS subscription_role TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS priced_by UUID;

-- The kind of a row: its login's role; otherwise what it says it is; otherwise
-- the contact, when the contact is only one of the two.
CREATE OR REPLACE FUNCTION public._subscription_role_of(p_login UUID, p_contact UUID, p_free_seat BOOLEAN, p_description TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_role  TEXT;
  v_types TEXT[];
BEGIN
  IF p_login IS NOT NULL THEN
    SELECT role::TEXT INTO v_role FROM user_accounts WHERE id = p_login;
    IF v_role IN ('partner', 'supplier') THEN RETURN v_role; END IF;
  END IF;
  IF p_free_seat IS TRUE OR p_description ILIKE '%partner%' THEN RETURN 'partner'; END IF;
  IF p_description ILIKE '%supplier%' OR p_description ~* '^Free [0-9]+-day introductory' THEN RETURN 'supplier'; END IF;
  SELECT COALESCE(NULLIF(contact_types, '{}'), ARRAY[contact_type::TEXT]) INTO v_types FROM contacts WHERE id = p_contact;
  IF 'partner' = ANY (v_types) AND NOT ('supplier' = ANY (v_types)) THEN RETURN 'partner'; END IF;
  IF 'supplier' = ANY (v_types) AND NOT ('partner' = ANY (v_types)) THEN RETURN 'supplier'; END IF;
  RETURN NULL;
END;
$$;

UPDATE public.subscriptions
   SET subscription_role = public._subscription_role_of(user_account_id, contact_id, is_free_seat, description)
 WHERE subscription_role IS NULL;

UPDATE public.subscriptions
   SET is_trial = TRUE
 WHERE is_trial IS NOT TRUE AND is_free_seat IS NOT TRUE AND COALESCE(amount, 0) = 0
   AND description ~* '^Free [0-9]+-day introductory';

-- ── 3. the rule ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._subscriptions_price_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_floor public.subscription_price_floors%ROWTYPE;
  v_units NUMERIC;
  v_min   NUMERIC;
BEGIN
  IF NEW.subscription_role IS NULL THEN
    NEW.subscription_role := public._subscription_role_of(NEW.user_account_id, NEW.contact_id, NEW.is_free_seat, NEW.description);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_free_seat IS NOT TRUE AND COALESCE(NEW.amount, 0) = 0
     AND NEW.description ~* '^Free [0-9]+-day introductory' THEN
    NEW.is_trial := TRUE;
  END IF;

  -- Free by design, or nothing about the price changed.
  IF NEW.is_free_seat IS TRUE OR NEW.is_trial IS TRUE THEN RETURN NEW; END IF;
  -- Only the PRICE is checked — amount, dates, currency. Paying a row, switching
  -- it on, giving it to a login, or its kind being filled in for the first time
  -- never is, or an old row priced under today's minimum could not be paid.
  IF TG_OP = 'UPDATE'
     AND NEW.amount     IS NOT DISTINCT FROM OLD.amount
     AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date   IS NOT DISTINCT FROM OLD.end_date
     AND NEW.currency   IS NOT DISTINCT FROM OLD.currency THEN
    RETURN NEW;
  END IF;
  IF NEW.subscription_role IS NULL THEN RETURN NEW; END IF;

  -- The super admin's own exceptions.
  IF NEW.priced_by IS NOT NULL AND EXISTS (
       SELECT 1 FROM user_accounts WHERE id = NEW.priced_by AND role::TEXT = 'super_admin' AND status = 'active') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_floor FROM public.subscription_price_floors WHERE role = NEW.subscription_role;
  IF NOT FOUND THEN RETURN NEW; END IF;

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

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: floor partner 10 USD / year and supplier 10 USD / month; rows
-- partner 18 and supplier 1 (no "(unknown)"); free seats / trials 10 / 0;
-- below_minimum_today 1 — the super admin's 0-priced "System Reserve", which
-- is left as it is; trigger installed.

SELECT 'floor' AS what, role AS kind, amount::TEXT || ' ' || currency || ' / ' || period AS detail
  FROM public.subscription_price_floors
UNION ALL
SELECT 'rows', COALESCE(subscription_role, '(unknown)'), COUNT(*)::TEXT
  FROM public.subscriptions GROUP BY subscription_role
UNION ALL
SELECT 'free seats / trials', '', SUM(CASE WHEN is_free_seat THEN 1 ELSE 0 END)::TEXT || ' / '
                                  || SUM(CASE WHEN is_trial THEN 1 ELSE 0 END)::TEXT
  FROM public.subscriptions
UNION ALL
SELECT 'below_minimum_today', '', COUNT(*)::TEXT
  FROM public.subscriptions s JOIN public.subscription_price_floors f ON f.role = s.subscription_role
 WHERE s.is_free_seat IS NOT TRUE AND s.is_trial IS NOT TRUE
   AND COALESCE(s.amount, 0) < f.amount * GREATEST(1, ROUND(((s.end_date - s.start_date) + 1)
                                       / CASE f.period WHEN 'year' THEN 365.0 ELSE 30.4375 END))
UNION ALL
SELECT 'trigger', '', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_subscriptions_price_floor')
                           THEN 'installed' ELSE 'MISSING' END;

NOTIFY pgrst, 'reload schema';
