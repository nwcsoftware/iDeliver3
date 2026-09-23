-- ============================================================================
-- fix154 — a payment that was not cash can say how it arrived
-- ----------------------------------------------------------------------------
-- payment_collections records what was paid, in what currency, by whom and
-- when. For cash that is the whole story: the money is in the drawer and the
-- driver's name is the receipt.
--
-- For anything else it is not. A bank transfer, a cheque, an OMT or a Western
-- Union has a REFERENCE — the number the office quotes when the customer says
-- they paid and the bank says they did not — and it went through SOMEBODY: a
-- bank, an exchange house, a wallet. Neither had anywhere to live, so both
-- ended up in the notes field or nowhere, which means neither can be searched,
-- reported on, or reconciled against a statement.
--
-- Two columns, both free text, both optional:
--
--   reference      the transfer / cheque / receipt number as the provider
--                  issued it. Text, not a number: these carry letters, dashes
--                  and leading zeros, and a leading zero eaten by a numeric
--                  column is a reference that no longer matches anything.
--
--   provider_name  who it came through — "Bank Audi", "OMT", "Western Union".
--                  A NAME, not a contact: these are not parties we trade with
--                  and giving them contact rows would put a bank in the
--                  customer picker. provider_id elsewhere in this schema means
--                  a contact, so this is deliberately not called provider.
--
-- NOTHING IS MADE MANDATORY. 9,032 of the 9,033 payments on record are cash
-- and want neither field; a NOT NULL default would have written an empty
-- string onto every one of them and turned "no reference" into "a reference
-- that is blank". The form asks for these only when the method is not cash.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

ALTER TABLE public.payment_collections
  ADD COLUMN IF NOT EXISTS reference     TEXT,
  ADD COLUMN IF NOT EXISTS provider_name TEXT;

COMMENT ON COLUMN public.payment_collections.reference IS
  'The transfer, cheque or receipt number as the provider issued it (fix154). Text, because these carry letters and leading zeros. NULL for cash.';

COMMENT ON COLUMN public.payment_collections.provider_name IS
  'Who the payment came through — a bank, exchange house or wallet, by name (fix154). Free text, not a contact: these are not parties we trade with. NULL for cash.';

-- Finding the payment somebody is asking about, by the number they quote.
CREATE INDEX IF NOT EXISTS idx_payment_collections_reference
  ON public.payment_collections (reference)
  WHERE reference IS NOT NULL;

-- ── check ───────────────────────────────────────────────────────────────────
-- Both columns exist and start empty. non_cash is how many payments could
-- carry them today — one, which is why this was easy to live without and
-- worth fixing before it is not.

SELECT
  (SELECT COUNT(*) FROM public.payment_collections)                              AS payments,
  (SELECT COUNT(*) FROM public.payment_collections
    WHERE COALESCE(collection_type::TEXT, 'cash') <> 'cash')                     AS non_cash,
  (SELECT COUNT(*) FROM public.payment_collections WHERE reference IS NOT NULL)  AS with_reference,
  (SELECT COUNT(*) FROM public.payment_collections WHERE provider_name IS NOT NULL) AS with_provider;

NOTIFY pgrst, 'reload schema';
