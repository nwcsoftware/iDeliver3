-- ============================================================================
-- fix128 — the subscription agreement a supplier / partner accepts on sign-in
-- ----------------------------------------------------------------------------
-- fix110 lets a 2nd party in while their subscription is paid, activated and in
-- date. fix128 adds the second half of that: before they see any of their pages
-- they must ACCEPT the subscription agreement — the monthly fees they are
-- signing up to, and the free introductory period they are on right now.
--
--   status  pending  — never answered (also: no row at all)
--           agreed   — accepted; the portal opens
--           rejected — declined; they are signed out and the office sees it
--
-- The prices, the trial length and the exact wording shown are COPIED INTO THE
-- ROW when they answer. An agreement is a record of what someone accepted on a
-- day, so it must not silently re-write itself when the price list changes.
--
-- One row per contact per agreement version: publishing a new version (v2)
-- therefore asks everyone again, without destroying what they accepted before.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_agreements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID,
  contact_id     UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  version        TEXT NOT NULL DEFAULT 'v1',
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'agreed', 'rejected')),

  -- who answered, from where, and when
  responded_at   TIMESTAMPTZ,
  responded_by   UUID,        -- the signing user's user_id
  responded_name TEXT,        -- as displayed at the time
  device         TEXT,
  note           TEXT,        -- their words when declining

  -- what they were shown (frozen at the moment of answering)
  plan           TEXT,        -- the plan they are on: basic | pro | pro_max
  basic_price    NUMERIC,
  pro_price      NUMERIC,
  pro_max_price  NUMERIC,
  currency       TEXT DEFAULT 'USD',
  trial_days     INTEGER,
  trial_ends_on  DATE,
  agreement_text TEXT,

  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- One answer per contact per version — the app upserts on this pair, so a
-- contact who declines and later accepts updates their row rather than
-- collecting a pile of contradictory ones.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_agreements_contact_version_idx
  ON public.subscription_agreements (contact_id, version);

CREATE INDEX IF NOT EXISTS subscription_agreements_status_idx
  ON public.subscription_agreements (status);

-- Same dev anon policy as the rest of the app's tables: the gate has to read
-- and write this from the client, under the project's custom-auth posture.
ALTER TABLE public.subscription_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_subscription_agreements" ON public.subscription_agreements;
CREATE POLICY "dev_anon_subscription_agreements"
  ON public.subscription_agreements FOR ALL TO anon USING (true) WITH CHECK (true);

-- Where everyone stands today.
SELECT COALESCE(a.status, 'pending') AS agreement_status, count(*) AS parties
FROM public.contacts AS c
LEFT JOIN public.subscription_agreements AS a
       ON a.contact_id = c.id AND a.version = 'v1'
WHERE (c.contact_types && ARRAY['supplier', 'partner']::TEXT[]
       OR c.contact_type IN ('supplier', 'partner'))
  AND COALESCE(c.is_active, TRUE)
GROUP BY 1
ORDER BY 1;

NOTIFY pgrst, 'reload schema';
