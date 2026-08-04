-- ============================================================================
-- fix111 — free introductory subscription for every existing supplier/partner
-- ----------------------------------------------------------------------------
-- fix110 locks 2nd parties out until they hold a paid, activated subscription.
-- This grants every existing supplier/partner a FREE one running until
-- 31/08/2026 so nobody is locked out in the meantime.
--
--   amount 0, is_paid = TRUE (nothing to collect), is_active = TRUE
--   start_date = today, end_date = 2026-08-31
--
-- Contacts that ALREADY have any subscription row are skipped, so a real
-- subscription entered by hand is never duplicated or overridden.
--
-- Safe to run multiple times (re-running only covers contacts still without
-- a subscription).
-- ============================================================================

INSERT INTO public.subscriptions (
  company_id, contact_id, description,
  start_date, end_date,
  amount, currency,
  is_paid, paid_at, paid_by_note,
  is_active
)
SELECT
  c.company_id,
  c.id,
  'Free introductory subscription',
  CURRENT_DATE,
  DATE '2026-08-31',
  0,
  'USD',
  TRUE,
  NOW(),
  'Free period — no payment required',
  TRUE
FROM public.contacts AS c
WHERE (
        c.contact_types && ARRAY['supplier', 'partner']::text[]
        OR c.contact_type IN ('supplier', 'partner')
      )
  AND COALESCE(c.is_active, TRUE)
  AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions AS s WHERE s.contact_id = c.id
      );

-- How many are now covered until the free period ends.
SELECT count(*) AS free_subscriptions
FROM public.subscriptions
WHERE description = 'Free introductory subscription'
  AND end_date = DATE '2026-08-31';

NOTIFY pgrst, 'reload schema';
