-- ============================================================================
-- fix152 — the contact flag stops disagreeing with the account, for good
-- ----------------------------------------------------------------------------
-- Since fix144 the reports follow THE ACCOUNT AN ORDER BILLS TO. That is the
-- decision and nothing here reopens it: an order charged to a credit account is
-- a credit order, whatever the customer record happens to say.
--
-- But contacts.credit_debit_allowed did not go away. It is still what the
-- contact form ticks, what the customer app shows a customer about themselves,
-- and the fallback the order form uses for a contact that has no accounts yet.
-- So when it disagrees with the accounts, the same customer reads as credit in
-- one place and cash in another, and nobody can tell which is the mistake.
--
-- That is what was found on the Closed Orders page: one order for Leila
-- Chammas, USD 6.00, billed to a CREDIT account by a contact whose flag said
-- credit was not allowed. The order was counted correctly — as credit — and it
-- looked like the totals had changed for no reason.
--
-- SEVEN CONTACTS ARE IN THAT STATE. Every one of them the same way round: they
-- hold a credit account while their flag says otherwise. None are the reverse.
--
--   Alber Farah · Rouba Tarabay · Jean Paul Chweifity · Vincent Flora
--   Maria Ghosn · Leila Chammas · Mirna Saikaly
--
-- WHICH SIDE WINS. The account. It is what the money is actually billed to,
-- what every report now reads, and what the office picks when it takes an
-- order. The flag is a summary of it, so the flag is what gets corrected.
--
-- ANY credit account makes the flag true, not just the primary one. The flag
-- answers "may this contact take credit at all", and a contact holding one cash
-- account and one credit account may. One contact holds both today.
--
-- AND IT WILL NOT DRIFT AGAIN. A trigger keeps the flag in step whenever an
-- account is added, re-typed, deactivated or removed, so the next disagreement
-- cannot be created by hand in the Accounts tab. fix144 already restamps a
-- contact's OPEN orders when an account is re-typed; this is the same idea one
-- level up.
--
-- NO ORDER IS RESTAMPED HERE, because none needs it: every one of the 9,560
-- orders already carries a stamp that matches the account it names. This
-- migration only touches contacts.
--
-- Run once in the Supabase SQL editor, after fix144/fix145.
-- Safe to re-run: it sets the flag to what the accounts already say.
-- ============================================================================

-- ── 1. what is about to change ──────────────────────────────────────────────
-- Listed BEFORE the update, so there is a record of who moved and why.

SELECT c.code,
       COALESCE(NULLIF(TRIM(c.company_name), ''),
                TRIM(CONCAT_WS(' ', c.first_name, c.last_name))) AS name,
       c.credit_debit_allowed                                    AS flag_was,
       TRUE                                                      AS flag_becomes,
       string_agg(s.code || ' (' || s.account_type || ')', ', ' ORDER BY s.code) AS accounts
  FROM public.contacts c
  JOIN public.sub_accounts s ON s.contact_id = c.id
 WHERE s.account_type = 'credit'
   AND s.is_active IS NOT FALSE
   AND c.credit_debit_allowed IS DISTINCT FROM TRUE
 GROUP BY c.id, c.code, c.company_name, c.first_name, c.last_name, c.credit_debit_allowed
 ORDER BY 2;

-- ── 2. align the flag to the accounts ───────────────────────────────────────

-- Holds at least one live credit account → credit is allowed.
UPDATE public.contacts c
   SET credit_debit_allowed = TRUE
 WHERE c.credit_debit_allowed IS DISTINCT FROM TRUE
   AND EXISTS (SELECT 1 FROM public.sub_accounts s
                WHERE s.contact_id = c.id
                  AND s.account_type = 'credit'
                  AND s.is_active IS NOT FALSE);

-- Holds accounts, none of them credit → credit is not allowed. A contact with
-- NO accounts at all is deliberately left alone: there is nothing to read the
-- answer from, and the flag is the only thing the order form has to go on.
UPDATE public.contacts c
   SET credit_debit_allowed = FALSE
 WHERE c.credit_debit_allowed IS TRUE
   AND EXISTS (SELECT 1 FROM public.sub_accounts s WHERE s.contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.sub_accounts s
                    WHERE s.contact_id = c.id
                      AND s.account_type = 'credit'
                      AND s.is_active IS NOT FALSE);

-- ── 3. keep them in step from now on ────────────────────────────────────────
-- Whenever a contact's accounts change — added, re-typed, deactivated, deleted
-- — the flag is recomputed from what is left. One function, both directions.

CREATE OR REPLACE FUNCTION public.sub_accounts_sync_contact_credit_flag()
RETURNS TRIGGER AS $$
DECLARE v_contact UUID;
BEGIN
  v_contact := COALESCE(NEW.contact_id, OLD.contact_id);
  IF v_contact IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.contacts c
     SET credit_debit_allowed = EXISTS (
           SELECT 1 FROM public.sub_accounts s
            WHERE s.contact_id = v_contact
              AND s.account_type = 'credit'
              AND s.is_active IS NOT FALSE)
   WHERE c.id = v_contact
     -- Only write when it actually differs, so this never fights the contact
     -- form's own save or loops through an UPDATE trigger on contacts.
     AND c.credit_debit_allowed IS DISTINCT FROM EXISTS (
           SELECT 1 FROM public.sub_accounts s
            WHERE s.contact_id = v_contact
              AND s.account_type = 'credit'
              AND s.is_active IS NOT FALSE);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sub_accounts_sync_credit_flag ON public.sub_accounts;
CREATE TRIGGER trg_sub_accounts_sync_credit_flag
  AFTER INSERT OR DELETE OR UPDATE OF account_type, is_active, contact_id
  ON public.sub_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sub_accounts_sync_contact_credit_flag();

-- ── 4. check ────────────────────────────────────────────────────────────────
-- still_disagreeing must be 0. orders_disagreeing must be 0 — it was already,
-- and nothing here should have changed that.

SELECT
  (SELECT COUNT(*) FROM public.contacts c
    WHERE EXISTS (SELECT 1 FROM public.sub_accounts s WHERE s.contact_id = c.id)
      AND c.credit_debit_allowed IS DISTINCT FROM EXISTS (
            SELECT 1 FROM public.sub_accounts s
             WHERE s.contact_id = c.id
               AND s.account_type = 'credit'
               AND s.is_active IS NOT FALSE))            AS still_disagreeing,
  (SELECT COUNT(*) FROM public.contacts c
    WHERE c.credit_debit_allowed IS TRUE)                AS credit_contacts_now,
  (SELECT COUNT(DISTINCT s.contact_id) FROM public.sub_accounts s
    WHERE s.account_type = 'credit' AND s.is_active IS NOT FALSE
      AND s.contact_id IS NOT NULL)                      AS contacts_with_a_credit_account,
  (SELECT COUNT(*) FROM public.delivery_orders o
     JOIN public.sub_accounts s ON s.id = o.sub_account_id
    WHERE o.account_nature IS DISTINCT FROM
          (CASE WHEN s.account_type = 'credit' THEN 'Credit' ELSE 'Cash' END)) AS orders_disagreeing,
  (SELECT COUNT(*) FROM public.delivery_orders
    WHERE account_nature IS NULL)                        AS orders_unstamped;

NOTIFY pgrst, 'reload schema';
