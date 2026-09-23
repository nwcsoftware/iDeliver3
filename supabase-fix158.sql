-- ============================================================================
-- fix158 — an admin may reopen a recent order, and the order says what happened
-- ----------------------------------------------------------------------------
-- Reopening a closed order was the super admin's alone. In practice a mistake
-- is usually found within a day or two by the person who made it, and having
-- to fetch the super admin for a wrong fee is how orders get left wrong.
--
-- So an administrator may reopen an order that closed recently — recently
-- being a number of days the SUPER ADMIN sets, in App Settings, company-wide.
-- Set it to zero and nothing changes: reopening is the super admin's again.
--
-- What this migration adds is the record. Editing a closed order is not like
-- editing an open one: the money has already been counted, the stock has
-- already moved, and the partner has already been credited. So the order
-- carries its own account of having been reopened and of what the edit
-- disturbed.
--
--   audit_note        what happened, appended, never replaced. The order form
--                     does not write this column at all — it is written by the
--                     app when an order is reopened or an edit is pushed
--                     through a warning, and edited by hand ONLY on the super
--                     admin's own editor. An administrator can read it and
--                     cannot touch it.
--
--   reopened_at       when it was last reopened, and by whom. Kept as history:
--   reopened_by       it is not cleared when the order closes again, because
--   reopened_by_name  "this order was reopened once" stays true afterwards.
--
-- A NOTE ON WHERE THE LOCK LIVES. This application signs users in against its
-- own user_accounts table, not Supabase auth, so the database cannot tell an
-- admin from a super admin inside a policy — every client arrives under the
-- same anon key. The protection on audit_note is therefore that the order form
-- never sends the column and no screen offers an administrator a way to type
-- into it. That is a real protection against the mistake it is meant to stop —
-- an admin quietly rewriting the account of their own edit — and it is not a
-- defence against someone with the key and a terminal. Worth knowing which one
-- you have.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS audit_note       TEXT,
  ADD COLUMN IF NOT EXISTS reopened_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by      UUID,
  ADD COLUMN IF NOT EXISTS reopened_by_name TEXT;

COMMENT ON COLUMN public.delivery_orders.audit_note IS
  'The order''s own account of having been reopened and re-edited (fix158). Appended, never replaced. Written by the application; editable by hand only by a super admin.';

COMMENT ON COLUMN public.delivery_orders.reopened_at IS
  'When this order was last reopened after being closed (fix158). Kept after it closes again — that it was reopened stays true.';

-- Finding what has been reopened, which is the question an audit starts from.
CREATE INDEX IF NOT EXISTS idx_delivery_orders_reopened_at
  ON public.delivery_orders (reopened_at DESC)
  WHERE reopened_at IS NOT NULL;

-- ── the window, as a company-wide setting ───────────────────────────────────
-- Seeded to 2 days. The super admin changes it in App Settings; this only puts
-- a value there so the setting has a starting point rather than appearing
-- blank. Left alone if somebody has already set one.

UPDATE public.app_global_settings
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
                            '{adminReopenDays}', '2'::jsonb, TRUE),
       updated_at = NOW()
 WHERE id = 'global'
   AND NOT (COALESCE(settings, '{}'::jsonb) ? 'adminReopenDays');

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect the three columns present, adminReopenDays set, and nothing reopened
-- yet.

SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delivery_orders'
      AND column_name IN ('audit_note', 'reopened_at', 'reopened_by', 'reopened_by_name')) AS columns_added,
  (SELECT settings->>'adminReopenDays' FROM public.app_global_settings WHERE id = 'global') AS admin_reopen_days,
  (SELECT COUNT(*) FROM public.delivery_orders WHERE reopened_at IS NOT NULL)               AS reopened_so_far,
  (SELECT COUNT(*) FROM public.delivery_orders WHERE audit_note IS NOT NULL)                AS with_audit_note;

NOTIFY pgrst, 'reload schema';
