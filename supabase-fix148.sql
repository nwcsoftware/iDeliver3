-- =============================================================================
-- fix148 — a chargeable partner with nothing on file gets a pending seat
-- -----------------------------------------------------------------------------
-- Three partners past the tenth hold no subscription row of any kind:
--
--   Bellagio        PTN-000058
--   Maison Rasha    PTN-000080
--   Shein by Jeff   PTN-000081
--
-- They are ALREADY locked out — checkSubscriptionAccess() refuses a party that
-- is subject to a subscription and has none, so this migration does not change
-- who can sign in. What it changes is what the office and the partner can SEE.
--
-- Today the office looks at those three and finds nothing: no row, no amount,
-- no date. Nothing distinguishes "this partner owes USD 10 and has not paid"
-- from "somebody forgot to set this up" — and the partner is told only that
-- their subscription "hasn't been set up yet", which reads like our mistake
-- rather than an unpaid invoice.
--
-- So each gets a seat placed against them at the real price, marked NOT PAID and
-- NOT ACTIVATED. The debt is written down, the amount is visible on the
-- Subscriptions page, and the row is the thing that gets activated when they
-- settle — rather than something the office has to remember to create.
--
-- WHAT THIS DOES NOT DO. It does not open anything. is_paid = false and
-- is_active = false both fail isSubscriptionActive(), so the portal stays shut
-- until the office confirms payment and activates the row. Nor does it touch
-- the three chargeable partners who are on a live free trial — Kitchefia,
-- Tule beauty and Sporty / La Voga are inside a period they were given, and
-- ending it early is a decision about customers, not a data repair.
--
-- The shape of the row is deliberately the same one the Renew button on the
-- Subscriptions page produces, so a seat created here and a seat created there
-- are indistinguishable afterwards.
--
-- NOTE ON THE LABEL. subscriptionStatus() tests is_active BEFORE is_paid, so a
-- row that is neither reads as "Deactivated" on screen, not "Unpaid". If the
-- office would rather these read as Unpaid — "awaiting payment confirmation",
-- which names the actual blocker — set is_active TRUE below and leave is_paid
-- FALSE. Access is refused either way; only the wording changes.
--
-- Run once in the Supabase SQL editor, AFTER fix146. Safe to re-run.
-- =============================================================================

WITH seated AS (
  SELECT c.id,
         c.company_id,
         ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS rank
    FROM contacts c
   WHERE c.is_active IS NOT FALSE
     AND 'partner'  = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND 'supplier' <> ALL (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND EXISTS (SELECT 1 FROM user_accounts u WHERE u.contact_id = c.id)
)
INSERT INTO public.subscriptions
  (company_id, contact_id, description, start_date, end_date, amount, currency,
   is_paid, is_active, paid_by_note)
SELECT
  s.company_id,
  s.id,
  'Annual partner seat — ' || to_char(CURRENT_DATE, 'YYYY') || ' — awaiting payment',
  CURRENT_DATE,
  (CURRENT_DATE + INTERVAL '1 year' - INTERVAL '1 day')::DATE,
  10,
  'USD',
  FALSE,   -- not paid
  FALSE,   -- not activated: the portal stays shut until the office turns it on
  'Placed by fix148 — partner beyond the ten included seats, no subscription on file.'
FROM seated s
WHERE s.rank > 10
  AND NOT EXISTS (SELECT 1 FROM public.subscriptions x WHERE x.contact_id = s.id);

-- -----------------------------------------------------------------------------
-- CHECK — every chargeable partner, and whether anything lets them in
-- -----------------------------------------------------------------------------
-- chargeable_with_no_row should now be 0: every partner past the tenth has a
-- row saying what they owe. chargeable_able_to_sign_in counts the ones a LIVE
-- subscription still admits — today the three on free trials, which is expected
-- and is not what this migration set out to change.

WITH seated AS (
  SELECT c.id,
         ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS rank
    FROM contacts c
   WHERE c.is_active IS NOT FALSE
     AND 'partner'  = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND 'supplier' <> ALL (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND EXISTS (SELECT 1 FROM user_accounts u WHERE u.contact_id = c.id)
),
chargeable AS (SELECT * FROM seated WHERE rank > 10)
SELECT
  (SELECT COUNT(*) FROM chargeable)                                            AS chargeable_partners,
  (SELECT COUNT(*) FROM chargeable ch
     WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions x WHERE x.contact_id = ch.id))
                                                                               AS chargeable_with_no_row,
  (SELECT COUNT(*) FROM chargeable ch
     WHERE EXISTS (SELECT 1 FROM public.subscriptions x
                    WHERE x.contact_id = ch.id AND x.is_paid AND x.is_active
                      AND CURRENT_DATE BETWEEN x.start_date AND x.end_date))    AS chargeable_able_to_sign_in,
  (SELECT COUNT(*) FROM chargeable ch
     WHERE EXISTS (SELECT 1 FROM public.subscriptions x
                    WHERE x.contact_id = ch.id AND x.amount > 0 AND NOT x.is_paid))
                                                                               AS seats_awaiting_payment,
  (SELECT COALESCE(SUM(x.amount), 0) FROM public.subscriptions x
     JOIN chargeable ch ON ch.id = x.contact_id
    WHERE x.amount > 0 AND NOT x.is_paid)                                      AS usd_outstanding;
