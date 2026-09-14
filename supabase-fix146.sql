-- =============================================================================
-- fix146 — seats: the free allowance written down, and the hole that let a
--          former partner keep its portal
-- -----------------------------------------------------------------------------
-- Three things, all of them consequences of the same gap: the seat rule existed
-- in code but was never written into the data, so nothing could be checked
-- against it.
--
--   1. KITCHEFIA. Its contact was changed to `customer` while its login kept
--      role `partner`. The sign-in gate asked "is this contact a party?", got
--      "no", and let it through as EXEMPT — a partner portal open to a contact
--      that was no longer a partner, holding no seat and paying nothing. The
--      contact is restored to partner here; the gate itself is fixed in
--      src/lib/subscriptions.js, which from now on refuses a login whose role
--      no longer matches its contact.
--
--   2. THE FREE TEN. Ten partner seats are included in the annual package
--      (article A5A) and the eleventh onward costs USD 10 a year. The ten were
--      only ever implied — they had no subscription rows — so "who is free and
--      who owes" could not be read from the data, only recomputed. Each of the
--      ten now carries a row saying so.
--
--   3. OFFICE SEATS. Call-centre users (6 included) and administrators (4) are
--      seats too, but they are logins with no contact at all, and
--      subscriptions.contact_id is NOT NULL. The table is widened so a seat can
--      belong to a user account instead, which is what lets an over-allowance
--      office seat be recorded and invoiced rather than tracked on paper.
--
-- The free ten are ranked by when the CONTACT was registered, which is the rule
-- rankPartners() and the sign-in gate already apply. Ranking by login date
-- instead would move four partners across the line, so the two must not drift.
--
-- Run once in the Supabase SQL editor, AFTER fix110. Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. KITCHEFIA IS A PARTNER AGAIN
-- -----------------------------------------------------------------------------
-- Kept as a customer as well as a partner: they hold order history as a
-- customer, and this app supports a contact carrying both roles. The PRIMARY
-- type becomes partner, which is what the code reads first and what the contact
-- code (PTN-000057) said all along.
--
-- Their contact was registered 2026-08-01, which places them eleventh among
-- seated partners — so restoring them does not displace any of the free ten;
-- it adds one more chargeable seat.

UPDATE contacts
   SET contact_type  = 'partner',
       contact_types = (
         SELECT ARRAY(SELECT DISTINCT unnest(
           COALESCE(NULLIF(contact_types, '{}'), ARRAY[contact_type::TEXT]) || ARRAY['partner']::TEXT[]
         ))
       )
 WHERE code = 'PTN-000057';

-- -----------------------------------------------------------------------------
-- 2. SUBSCRIPTIONS CAN BELONG TO A LOGIN, NOT ONLY A CONTACT
-- -----------------------------------------------------------------------------
-- A partner or supplier subscribes as a CONTACT. A call-centre user or an
-- administrator has no contact — they are a login on the company's own package
-- — so an over-allowance office seat needs somewhere to live. One row shape
-- serves both: exactly one of the two references is set.

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS user_account_id UUID
  REFERENCES public.user_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.subscriptions ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_owner_chk;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_owner_chk
  CHECK (
    (contact_id IS NOT NULL AND user_account_id IS NULL) OR
    (contact_id IS NULL AND user_account_id IS NOT NULL)
  );

COMMENT ON COLUMN public.subscriptions.user_account_id IS
  'The login this seat belongs to, for office seats (call-centre, administrator) that have no contact. Exactly one of contact_id / user_account_id is set (fix146).';

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_account
  ON public.subscriptions (user_account_id) WHERE user_account_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. THE FREE TEN GET A ROW THAT SAYS SO
-- -----------------------------------------------------------------------------
-- Ranked exactly as rankPartners() does: partner contacts that are not also
-- suppliers, still active, holding a login, oldest contact first. A contact
-- that already has any subscription is skipped rather than given a second one.
--
-- The row is documentation, not a gate: a partner inside the first ten is
-- exempt whether or not a row exists, so nothing here can lock anybody out. It
-- exists so the allowance can be READ — on the Subscriptions page, in a query,
-- on an invoice — instead of being recomputed and taken on trust.

WITH seated AS (
  SELECT c.id,
         ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS rank
    FROM contacts c
   WHERE c.is_active IS NOT FALSE
     AND 'partner'  = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND 'supplier' <> ALL (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND EXISTS (SELECT 1 FROM user_accounts u WHERE u.contact_id = c.id)
)
INSERT INTO public.subscriptions
  (company_id, contact_id, description, start_date, end_date, amount, currency, is_paid, is_active)
SELECT
  c.company_id,
  s.id,
  'Included partner seat — inside the annual package (A5A)',
  CURRENT_DATE,
  (CURRENT_DATE + INTERVAL '1 year' - INTERVAL '1 day')::DATE,
  0,
  'USD',
  TRUE,
  TRUE
FROM seated s
JOIN contacts c ON c.id = s.id
WHERE s.rank <= 10
  AND NOT EXISTS (SELECT 1 FROM public.subscriptions x WHERE x.contact_id = s.id);

-- -----------------------------------------------------------------------------
-- 4. CHECK — who is free, who owes, and what the office seats look like
-- -----------------------------------------------------------------------------

WITH seated AS (
  SELECT c.id,
         COALESCE(NULLIF(c.company_name, ''), btrim(c.first_name || ' ' || c.last_name)) AS name,
         c.code,
         ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS rank
    FROM contacts c
   WHERE c.is_active IS NOT FALSE
     AND 'partner'  = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND 'supplier' <> ALL (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND EXISTS (SELECT 1 FROM user_accounts u WHERE u.contact_id = c.id)
)
SELECT
  (SELECT COUNT(*) FROM seated)                                              AS partner_seats,
  (SELECT COUNT(*) FROM seated WHERE rank <= 10)                             AS partner_free,
  (SELECT COUNT(*) FROM seated WHERE rank > 10)                              AS partner_chargeable,
  (SELECT COUNT(*) FROM seated s WHERE s.rank > 10
     AND NOT EXISTS (SELECT 1 FROM public.subscriptions x
                      WHERE x.contact_id = s.id AND x.is_active AND x.is_paid
                        AND CURRENT_DATE BETWEEN x.start_date AND x.end_date)) AS partner_chargeable_unpaid,
  (SELECT COUNT(*) FROM public.subscriptions WHERE contact_id IS NOT NULL)    AS subscription_rows_contacts,
  (SELECT COUNT(*) FROM public.subscriptions WHERE user_account_id IS NOT NULL) AS subscription_rows_office,
  (SELECT COUNT(*) FROM user_accounts WHERE role = 'admin'       AND status = 'active') AS admin_logins,
  (SELECT COUNT(*) FROM user_accounts WHERE role = 'call_center' AND status = 'active') AS call_centre_logins,
  (SELECT COUNT(*) FROM user_accounts u WHERE u.role IN ('partner','supplier')
     AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = u.contact_id
                      AND u.role::TEXT = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))))
                                                                             AS logins_whose_role_no_longer_matches;
