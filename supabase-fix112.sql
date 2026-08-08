-- ============================================================================
-- fix112 — change / feature requests
-- ----------------------------------------------------------------------------
-- The in-app version of docs/iDeliver-III-Change-Request-Form: an admin raises a
-- request (new feature, change, new report, problem, …), the super admin prices
-- or rejects it, and the admin accepts the price before work starts.
--
-- Lifecycle (change_requests.status):
--   draft      — being written by the admin (not visible as work yet)
--   submitted  — sent to the super admin; the admin may still edit/recall/delete
--   rejected   — super admin declined, with rejection_reason
--   quoted     — super admin returned an assessment + price; awaiting the admin
--   approved   — admin accepted the price → LOCKED for the admin from here on
--   in_progress / completed / cancelled — super admin drives these
--
-- change_request_lines holds the individual asks of one request (a request may
-- have several lines, each optionally priced).
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.change_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID,
  request_no        TEXT,                       -- CR-20260804-0001

  -- Section 1 — requester details
  requested_by      UUID,                       -- user_accounts.id
  requested_by_name TEXT,
  requester_role    TEXT,
  requester_phone   TEXT,
  requester_email   TEXT,
  company_label     TEXT,

  -- Section 2 — type & scope
  request_type      TEXT DEFAULT 'new_feature', -- new_feature|change_existing|new_report|problem|other
  request_type_other TEXT,
  modules           TEXT[] DEFAULT '{}'::text[],-- operations|partners|driver|customer|reports|other
  screen_page       TEXT,
  priority          TEXT DEFAULT 'medium',      -- low|medium|high

  -- Sections 3–5 — the request itself
  title             TEXT NOT NULL,
  description       TEXT,
  justification     TEXT,
  needed_by         DATE,

  -- Workflow
  status            TEXT DEFAULT 'draft',
  submitted_at      TIMESTAMPTZ,
  rejection_reason  TEXT,
  rejected_at       TIMESTAMPTZ,

  -- "For _NXCORE use only" — impact assessment (super admin)
  classification    TEXT,                       -- enhancement|defect
  assessment_summary TEXT,
  risk_notes        TEXT,
  estimated_effort  TEXT,
  price             NUMERIC DEFAULT 0,
  currency          TEXT DEFAULT 'USD',
  target_delivery   TEXT,
  assessed_by_name  TEXT,
  assessed_at       TIMESTAMPTZ,

  -- Admin's acceptance of the quoted price
  approved_by       UUID,
  approved_by_name  TEXT,
  approved_at       TIMESTAMPTZ,

  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.change_request_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  sort_order   INT DEFAULT 0,
  line_type    TEXT,          -- add|change|remove|report|problem
  module       TEXT,
  description  TEXT,
  notes        TEXT,
  price        NUMERIC,       -- optional per-line price set by the super admin
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS change_requests_status_idx      ON public.change_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS change_request_lines_req_idx    ON public.change_request_lines (request_id, sort_order);

-- Same dev anon policy as the rest of the app's tables.
ALTER TABLE public.change_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_request_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_change_requests" ON public.change_requests;
CREATE POLICY "dev_anon_change_requests"
  ON public.change_requests FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "dev_anon_change_request_lines" ON public.change_request_lines;
CREATE POLICY "dev_anon_change_request_lines"
  ON public.change_request_lines FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
