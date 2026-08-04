-- ============================================================================
-- fix110 — supplier / partner subscriptions
-- ----------------------------------------------------------------------------
-- A supplier or partner is created by an admin, but stays LOCKED OUT until the
-- super admin confirms their payment and activates a subscription. Only while a
-- subscription is active, paid and inside its date window may that 2nd party
-- sign in (and therefore add shop items or see orders).
--
--   contact_id   — the supplier/partner contact this subscription belongs to
--   description  — free text ("Standard plan — 12 months")
--   start_date / end_date — the paid period
--   amount + currency     — what was charged
--   is_paid + paid_at + paid_by_note — money-received confirmation
--   is_active    — the super admin's on/off switch (independent of the dates)
--
-- Super admin creates/edits/deletes; admins can read the list. That split is
-- enforced in the app (same custom-auth posture as the rest of the project).
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID,
  contact_id   UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  description  TEXT,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  amount       NUMERIC DEFAULT 0,
  currency     TEXT DEFAULT 'USD',
  is_paid      BOOLEAN DEFAULT FALSE,
  paid_at      TIMESTAMPTZ,
  paid_by_note TEXT,
  is_active    BOOLEAN DEFAULT FALSE,
  created_by   UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_contact_idx ON public.subscriptions (contact_id);
CREATE INDEX IF NOT EXISTS subscriptions_window_idx  ON public.subscriptions (is_active, is_paid, start_date, end_date);

-- Same dev anon policy as the rest of the app's tables: the login check has to
-- read this table before a session exists.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_subscriptions" ON public.subscriptions;
CREATE POLICY "dev_anon_subscriptions"
  ON public.subscriptions FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
