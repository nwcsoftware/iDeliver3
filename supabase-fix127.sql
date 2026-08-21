-- ============================================================================
-- fix127 — the free introductory subscriptions run 90 days, not to a fixed date
-- ----------------------------------------------------------------------------
-- fix111 granted every existing supplier/partner a FREE subscription ending on
-- a hard-coded 31/08/2026. That date has no relation to when each contact was
-- given the period, and the app now issues new trials as "90 days from the
-- start date" (src/lib/subscriptions.js → ensureTrialSubscription).
--
-- This brings the fix111 rows in line: end_date becomes start_date + 90 days.
--
--   free  = amount 0
--   fixed = end_date 31/08/2026
--
-- Paid subscriptions are untouched — the amount filter is what protects them.
--
-- ALREADY APPLIED to the live database (66 rows, 04/08/2026 → 02/11/2026).
-- Kept here so any other environment can be brought to the same state.
-- Safe to run more than once: after the first run nothing matches.
-- ============================================================================

UPDATE public.subscriptions
   SET end_date   = start_date + INTERVAL '90 days',
       updated_at = NOW()
 WHERE amount = 0
   AND end_date = DATE '2026-08-31';

-- What the free periods now look like.
SELECT start_date,
       end_date,
       (end_date - start_date) AS days,
       count(*)                AS subscriptions
FROM public.subscriptions
WHERE amount = 0
GROUP BY start_date, end_date
ORDER BY start_date;

NOTIFY pgrst, 'reload schema';
