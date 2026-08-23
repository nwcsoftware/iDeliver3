-- ============================================================================
-- fix136 — a subscription belongs to a LOGIN, and says who is billed for it
-- ----------------------------------------------------------------------------
-- Two corrections, both of which follow from what a subscription is actually
-- for: letting somebody sign in.
--
-- 1. NO LOGIN, NO SUBSCRIPTION. Trials were issued when a partner or supplier
--    CONTACT was created, whether or not anyone could ever sign in as them.
--    Most of them could not: of 82 subscriptions on file, 78 belonged to
--    contacts with no user account at all. They were counting against nothing,
--    ageing towards an expiry nobody would notice. From now on the trial is
--    issued when the ADMIN CREATES THE USERNAME AND PASSWORD, and this
--    migration removes the ones that were never needed. Only free rows are
--    removed — anything carrying money is left alone for a human to decide.
--
-- 2. WHO PAYS. A partner does not pay us: 3asari3 is invoiced for its partners
--    — ten inside the annual package, USD 10 per year for each one beyond. A
--    supplier does pay, monthly, for itself. Same table, two payers, so the
--    row now says which:
--
--      billed_to = 'company'  invoiced to 3asari3      (partners)
--      billed_to = 'party'    invoiced to the supplier (suppliers)
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billed_to TEXT NOT NULL DEFAULT 'party'
    CHECK (billed_to IN ('company', 'party'));

COMMENT ON COLUMN public.subscriptions.billed_to IS
  'company = invoiced to 3asari3 (partner seats); party = invoiced to the supplier itself';

-- ── 1. partners are billed to the company ───────────────────────────────────
UPDATE public.subscriptions AS s
SET billed_to = 'company'
FROM public.contacts AS c
WHERE c.id = s.contact_id
  AND s.billed_to <> 'company'
  AND NOT (c.contact_types && ARRAY['supplier']::TEXT[] OR c.contact_type = 'supplier')
  AND (c.contact_types && ARRAY['partner']::TEXT[] OR c.contact_type = 'partner');

-- ── 2. drop the free subscriptions of contacts that cannot sign in ──────────
-- Only amount = 0 rows: a subscription with money on it is somebody's payment
-- record and is never removed by a migration.
DELETE FROM public.subscriptions AS s
WHERE COALESCE(s.amount, 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.user_accounts AS u WHERE u.contact_id = s.contact_id
  );

-- What is left, and who is billed for it.
SELECT billed_to,
       count(*)                                   AS subscriptions,
       count(*) FILTER (WHERE amount = 0)         AS free,
       count(*) FILTER (WHERE amount > 0)         AS paid
FROM public.subscriptions
GROUP BY billed_to
ORDER BY billed_to;

NOTIFY pgrst, 'reload schema';
