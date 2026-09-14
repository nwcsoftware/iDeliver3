-- =============================================================================
-- fix147 — the ten included partner seats all say the same thing
-- -----------------------------------------------------------------------------
-- fix146 gave each of the ten included partner seats a row describing it as
-- what it is. Two of the ten already had a row and were deliberately skipped,
-- so as not to hand anybody a second subscription — and those two still carry
-- the wording they were created with in August:
--
--   Madame Bougie   "Free introductory subscription"
--   Shein koura     "Free introductory subscription"
--
-- The other eight read "Included partner seat — inside the annual package
-- (A5A)". Both sentences are true, but they are not the same fact: a free
-- introductory subscription is a trial that runs out, and an included seat is a
-- seat that was bought. Reading the list, the ten looked like two different
-- arrangements when they are one.
--
-- They are not trials. Those two rows predate the check in
-- ensureTrialSubscription() that now refuses to issue a trial to an exempt
-- partner — a countdown on a free arrangement — so the wording describes a rule
-- that no longer applies to them.
--
-- This only rewrites the description. The dates are left exactly as they are;
-- see the note at the end.
--
-- Run once in the Supabase SQL editor, AFTER fix146. Safe to re-run.
-- =============================================================================

WITH seated AS (
  SELECT c.id,
         ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS rank
    FROM contacts c
   WHERE c.is_active IS NOT FALSE
     AND 'partner'  = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND 'supplier' <> ALL (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND EXISTS (SELECT 1 FROM user_accounts u WHERE u.contact_id = c.id)
)
UPDATE public.subscriptions s
   SET description = 'Included partner seat — inside the annual package (A5A)',
       updated_at  = NOW()
  FROM seated
 WHERE s.contact_id = seated.id
   AND seated.rank <= 10
   AND s.description IS DISTINCT FROM 'Included partner seat — inside the annual package (A5A)';

-- -----------------------------------------------------------------------------
-- CHECK — the ten, and how many ways they now describe themselves
-- -----------------------------------------------------------------------------
-- distinct_descriptions should be 1. If it is 2, one of the ten is carrying a
-- second subscription row that this did not reach.

WITH seated AS (
  SELECT c.id,
         ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS rank
    FROM contacts c
   WHERE c.is_active IS NOT FALSE
     AND 'partner'  = ANY (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND 'supplier' <> ALL (COALESCE(NULLIF(c.contact_types, '{}'), ARRAY[c.contact_type::TEXT]))
     AND EXISTS (SELECT 1 FROM user_accounts u WHERE u.contact_id = c.id)
)
SELECT
  (SELECT COUNT(*) FROM seated WHERE rank <= 10)                               AS free_ten,
  (SELECT COUNT(DISTINCT s.description) FROM public.subscriptions s
     JOIN seated ON seated.id = s.contact_id WHERE seated.rank <= 10)          AS distinct_descriptions,
  (SELECT COUNT(*) FROM public.subscriptions s
     JOIN seated ON seated.id = s.contact_id
    WHERE seated.rank <= 10
      AND s.description = 'Included partner seat — inside the annual package (A5A)') AS rows_reading_included_seat,
  -- The dates are NOT touched by this migration. Two of the ten run to
  -- 2026-11-02 because they were written as 90-day trials, while the eight
  -- created by fix146 run a full year. Nothing turns on it — a partner inside
  -- the ten is exempt whether their row is in date or not — but a reader of the
  -- list sees two seats apparently expiring in November and may "renew" a seat
  -- that was never chargeable. This counts them.
  (SELECT COUNT(*) FROM public.subscriptions s
     JOIN seated ON seated.id = s.contact_id
    WHERE seated.rank <= 10 AND s.end_date < CURRENT_DATE + INTERVAL '6 months') AS free_seats_expiring_within_6_months;
