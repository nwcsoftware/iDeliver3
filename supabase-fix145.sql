-- =============================================================================
-- fix145 — reconcile the three customers whose ACCOUNT says cash while
--          everything they have ever done says credit
-- -----------------------------------------------------------------------------
-- fix144 moved the cash/credit question from the CONTACT (credit_debit_allowed)
-- to the ACCOUNT the order bills to. Its closing check found the two places
-- where those two answers disagree on this install. One of them is harmless.
-- The other hides money.
--
--   A. 11 contacts hold a CREDIT account while credit_debit_allowed is false.
--      Their 17 closed orders joined the credit reports — correctly: the
--      account is the record. It also surfaced LBP 3,000,000 still owed by
--      Sama Hills that the old flag was hiding. Nothing to repair; section 2
--      only makes the contact card agree with the account it already has.
--
--   B. 3 contacts are flagged credit_debit_allowed while their ONLY account is
--      typed cash. fix81 built each contact's first account from that flag as
--      it stood in July; these three were flagged afterwards, so the account
--      kept the type the flag used to have. fix144 then stamped every one of
--      their orders 'Cash' — and their orders left the credit statement:
--
--        Najwa Dandach   426 closed orders   USD    283 still owed
--        Rihab Darwich    11 closed orders   LBP 2,700,000 still owed
--        Abby Mezher      42 closed orders   USD     24 still owed
--
--      Between them they have TEN account-level credit settlements recorded on
--      the Credit Customers page — money collected against a running balance,
--      which is the one thing a cash account never does. So the account type is
--      what is wrong here, not the flag.
--
-- Why this needs SQL rather than the Accounts tab: re-typing an account in the
-- UI fires fix144's restamp trigger, which deliberately leaves CLOSED orders
-- alone — a settled statement must not change under the reader. That rule is
-- right for a change of TERMS and wrong for a correction of a MISTAKE, and
-- these 479 closed orders are the second kind. This migration is the explicit,
-- one-off exception, which is exactly why it is a migration and not a trigger.
--
-- Run once in the Supabase SQL editor, AFTER supabase-fix144.sql. Safe to
-- re-run: both sections match nothing once they have been applied.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. THE ACCOUNT FOLLOWS THE FLAG — for contacts that hold no credit account
-- -----------------------------------------------------------------------------
-- Only the contact's DEFAULT account is re-typed (the primary, else the oldest),
-- because that is the one every one of their orders already bills to. A contact
-- who has a credit account somewhere is not touched: their cash account is a
-- deliberate second account, not a mistake.

-- The SQL editor keeps one session across runs, so a leftover temp table from a
-- previous run would otherwise make this fail on the second execution.
DROP TABLE IF EXISTS fix145_retyped;

CREATE TEMP TABLE fix145_retyped AS
SELECT (contact_default_sub_account(c.id)).id AS sub_account_id, c.id AS contact_id
  FROM contacts c
 WHERE c.credit_debit_allowed IS TRUE
   AND EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM sub_accounts s
                    WHERE s.contact_id = c.id AND s.account_type::TEXT = 'credit');

UPDATE sub_accounts s
   SET account_type = 'credit'::account_type,
       description  = COALESCE(NULLIF(btrim(s.description), '') || ' ', '')
                      || 'Re-typed cash → credit by fix145: the contact is credit-allowed and settles on account.'
  FROM fix145_retyped f
 WHERE s.id = f.sub_account_id;

-- The orders. fix144's trigger has already restamped the OPEN ones as a side
-- effect of the UPDATE above; this is the closed history it deliberately left
-- behind, restamped here because the original stamp recorded a mistake rather
-- than a decision.
UPDATE delivery_orders o
   SET account_nature = 'Credit'
  FROM fix145_retyped f
 WHERE o.sub_account_id = f.sub_account_id
   AND o.account_nature IS DISTINCT FROM 'Credit';

-- Payments follow the orders they settle, so a payment's nature never contradicts
-- the charge it was taken against.
UPDATE payment_collections p
   SET account_nature = o.account_nature
  FROM delivery_orders o
 WHERE p.order_id = o.id
   AND p.account_nature IS DISTINCT FROM o.account_nature;

-- -----------------------------------------------------------------------------
-- 2. THE FLAG FOLLOWS THE ACCOUNT — for contacts that already hold one
-- -----------------------------------------------------------------------------
-- Nothing computes from credit_debit_allowed any more except the badge on the
-- contact card and the fallback for orders older than fix144. Leaving it false
-- on a contact who holds a credit account makes the card lie about a customer
-- who is, by their own account, allowed to run a balance.

UPDATE contacts c
   SET credit_debit_allowed = TRUE
 WHERE c.credit_debit_allowed IS NOT TRUE
   AND EXISTS (SELECT 1 FROM sub_accounts s
                WHERE s.contact_id = c.id AND s.account_type::TEXT = 'credit');

-- -----------------------------------------------------------------------------
-- 3. CHECK — the same two disagreements fix144 counted, now expected to be zero,
--    plus what moved back onto the credit side
-- -----------------------------------------------------------------------------

SELECT
  (SELECT COUNT(*) FROM contacts c
    WHERE c.credit_debit_allowed IS TRUE
      AND EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id
                        AND s.account_type::TEXT = 'credit'))          AS flagged_credit_no_credit_account,
  (SELECT COUNT(*) FROM contacts c
    WHERE c.credit_debit_allowed IS NOT TRUE
      AND EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id
                    AND s.account_type::TEXT = 'credit'))              AS credit_account_not_flagged,
  (SELECT COUNT(*) FROM fix145_retyped)                                AS accounts_retyped,
  (SELECT COUNT(*) FROM delivery_orders o JOIN fix145_retyped f
      ON o.sub_account_id = f.sub_account_id)                          AS orders_moved_to_credit,
  (SELECT COUNT(*) FROM delivery_orders WHERE account_nature = 'Credit') AS orders_credit_now,
  (SELECT COUNT(*) FROM delivery_orders WHERE account_nature = 'Cash')   AS orders_cash_now,
  (SELECT COUNT(*) FROM delivery_orders WHERE account_nature IS NULL)    AS orders_without_nature;
