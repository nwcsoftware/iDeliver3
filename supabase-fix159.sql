-- ============================================================================
-- fix159 — activate a subscription for its full term while the money is due,
--          and record HOW it was paid when it is
-- ----------------------------------------------------------------------------
-- Until now an unpaid subscription could only be switched on "on trust" for
-- 15 days (fix149), and marking one paid was a single click that recorded
-- nothing: no date it arrived, no method, no reference. A payment somebody
-- later needs to trace — an OMT transfer, a cheque — left no trail at all.
--
-- 1. CREDIT — the super admin may activate a subscription for its whole
--    period while payment is still pending. It is a decision, so it is signed
--    and dated:
--
--      credit_granted_at   when the super admin switched it on unpaid
--      credit_granted_by   who did (name, as the other *_by columns here)
--
--    The row stays is_paid = false throughout. It appears on the Due Payments
--    report as "Activated — payment due" until the payment is recorded.
--
-- 2. PAYMENT DETAILS — recorded when the money is confirmed:
--
--      payment_method      Cash, OMT, Whish, bank transfer, cheque…
--      payment_reference   the transfer / receipt / cheque number
--      paid_recorded_by    who confirmed it
--
--    paid_at and paid_by_note already exist and are reused.
--
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS credit_granted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credit_granted_by  TEXT,
  ADD COLUMN IF NOT EXISTS payment_method     TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference  TEXT,
  ADD COLUMN IF NOT EXISTS paid_recorded_by   TEXT;

COMMENT ON COLUMN public.subscriptions.credit_granted_at IS
  'Super admin activated this subscription for its full term while payment was still due (fix159).';
COMMENT ON COLUMN public.subscriptions.payment_reference IS
  'Transfer / receipt / cheque number recorded when the payment was confirmed (fix159).';

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect columns_added = 5, and today's money still owed listed per currency.

SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name IN ('credit_granted_at', 'credit_granted_by', 'payment_method',
                          'payment_reference', 'paid_recorded_by'))           AS columns_added,
  (SELECT COUNT(*) FROM public.subscriptions
    WHERE is_paid IS NOT TRUE AND COALESCE(amount, 0) > 0)                     AS subscriptions_owing,
  (SELECT string_agg(cur || ' ' || total, ', ')
     FROM (SELECT currency AS cur, SUM(amount)::TEXT AS total
             FROM public.subscriptions
            WHERE is_paid IS NOT TRUE AND COALESCE(amount, 0) > 0
            GROUP BY currency) t)                                              AS owing_by_currency;

NOTIFY pgrst, 'reload schema';
