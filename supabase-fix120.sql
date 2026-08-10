-- ============================================================================
-- fix120 — quotation rounds on a change request
-- ----------------------------------------------------------------------------
-- Pricing a change request is a negotiation, not a single act: the super admin
-- quotes, the admin either accepts or asks for a revision (optionally naming
-- the price they had in mind), the super admin re-quotes — possibly with a new
-- PDF — and so on until both sides agree. Every step is kept, with its date, so
-- the request carries the whole conversation.
--
-- change_request_quotes is that ledger. One row per event:
--
--   action = 'quoted'              super admin priced it (round 1, 2, 3 …)
--   action = 'revision_requested'  admin asked for a different price
--   action = 'accepted'            admin accepted the standing quote
--   action = 'rejected'            super admin declined the request
--
-- The live figures stay on change_requests (price, currency, quotation_pdf) so
-- nothing that reads a request today has to change; this table is the history
-- behind them, and each 'quoted' row keeps the PDF that was sent that round.
--
-- change_requests also gains:
--   ready_by     — the date the work is promised for, once the price is agreed
--   quote_round  — how many quotes have been sent (0 = none yet)
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.change_request_quotes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  round              INT  DEFAULT 1,          -- which quotation round this belongs to
  action             TEXT NOT NULL,           -- quoted|revision_requested|accepted|rejected
  actor_id           UUID,                    -- user_accounts.id
  actor_name         TEXT,
  actor_role         TEXT,                    -- super_admin|admin

  price              NUMERIC,                 -- quoted price, or the price the admin proposes
  currency           TEXT DEFAULT 'USD',
  message            TEXT,                    -- the note that went with this step
  ready_by           DATE,                    -- promised delivery date, when named

  quotation_pdf      TEXT,                    -- data:application/pdf;base64,… for this round
  quotation_filename TEXT,

  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.change_requests
  ADD COLUMN IF NOT EXISTS ready_by    DATE,
  ADD COLUMN IF NOT EXISTS quote_round INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS change_request_quotes_req_idx
  ON public.change_request_quotes (request_id, created_at);

-- Same dev anon policy as the rest of the app's tables.
ALTER TABLE public.change_request_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_change_request_quotes" ON public.change_request_quotes;
CREATE POLICY "dev_anon_change_request_quotes"
  ON public.change_request_quotes FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
