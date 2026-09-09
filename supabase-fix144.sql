-- =============================================================================
-- fix144 — every order names the account it bills to, and says whether that
--          account is Cash or Credit
-- -----------------------------------------------------------------------------
-- Until now an order could reach the database without ever naming an account.
-- fix81 made that legal on purpose: a NULL `sub_account_id` meant "the
-- customer's primary account", which is what kept pre-fix81 history on the
-- right account without a backfill of every row. Thousands of orders later,
-- that convention has three costs:
--
--   · Nothing is written down. 2,377 of 8,111 delivery orders carry no
--     sub_account_id at all — the account they belong to is re-derived on every
--     read, and would change the day someone flips which account is primary.
--   · A customer can only be in ONE category. Reports ask
--     contacts.credit_debit_allowed — a property of the PERSON — so a customer
--     holding both a cash account and a credit account is forced entirely into
--     one bucket, whichever the flag says.
--   · Payments name no account. payment_collections rows record the money but
--     not the account it settles, so a payment cannot be placed against the
--     account the order charged.
--
-- After this migration the account is a FACT ON THE ROW, decided when the order
-- is taken and never re-derived:
--
--   delivery_orders.sub_account_id   which account      (existed; now always filled)
--   delivery_orders.main_account     its number         (existed; now always filled)
--   delivery_orders.account_nature   'Cash' | 'Credit'  (NEW — stamped from the account)
--
--   payment_collections.sub_account_id / .main_account / .account_nature
--                                    (NEW — inherited from the order it pays)
--
-- `account_nature` is deliberately a STAMP, not a lookup. An account renamed or
-- re-typed years later must not silently rewrite what a closed order was billed
-- as; the stamp is what the order was sold on. The one exception is written
-- into section 6 below: re-typing an account DOES restamp orders that are still
-- open, because those have not been settled as anything yet.
--
-- Four triggers keep the stamp true no matter which client writes the row — the
-- office order form, the customer application, the partner portal, or a
-- hand-written SQL insert:
--
--   contacts            → a new contact gets its primary account row
--   delivery_orders     → an order resolves + stamps its account
--   payment_collections → a payment inherits its order's account
--   sub_accounts        → re-typing an account restamps its OPEN orders
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. THE COLUMNS
-- -----------------------------------------------------------------------------

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS account_nature TEXT;

ALTER TABLE delivery_orders DROP CONSTRAINT IF EXISTS delivery_orders_account_nature_chk;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_account_nature_chk
  CHECK (account_nature IS NULL OR account_nature IN ('Cash', 'Credit'));

COMMENT ON COLUMN delivery_orders.account_nature IS
  'Cash or Credit, stamped from the sub_account this order bills to (fix144). A stamp, not a lookup: it records what the order was billed as.';

-- A payment settles the account the ORDER charged, so it carries the same three
-- facts. Without them a payment can only be tied to an account through its
-- order, which breaks the moment an order is re-pointed at another account.
ALTER TABLE payment_collections ADD COLUMN IF NOT EXISTS sub_account_id UUID REFERENCES sub_accounts(id);
ALTER TABLE payment_collections ADD COLUMN IF NOT EXISTS main_account   TEXT;
ALTER TABLE payment_collections ADD COLUMN IF NOT EXISTS account_nature TEXT;

ALTER TABLE payment_collections DROP CONSTRAINT IF EXISTS payment_collections_account_nature_chk;
ALTER TABLE payment_collections ADD CONSTRAINT payment_collections_account_nature_chk
  CHECK (account_nature IS NULL OR account_nature IN ('Cash', 'Credit'));

COMMENT ON COLUMN payment_collections.sub_account_id IS
  'The account this payment settles — inherited from the order (fix144).';
COMMENT ON COLUMN payment_collections.main_account IS
  'That account''s number, copied at collection time (fix144).';
COMMENT ON COLUMN payment_collections.account_nature IS
  'Cash or Credit, copied from the order at collection time (fix144).';

CREATE INDEX IF NOT EXISTS idx_orders_account_nature
  ON delivery_orders (account_nature) WHERE account_nature IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_sub_account
  ON payment_collections (sub_account_id) WHERE sub_account_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. HELPERS
-- -----------------------------------------------------------------------------

-- The nature of an account, as the app writes it. The Chart of Accounts enum
-- carries five types; only 'credit' is credit — everything else settles now.
CREATE OR REPLACE FUNCTION account_nature_of(p_type TEXT)
RETURNS TEXT AS $$
  SELECT CASE WHEN lower(coalesce(p_type, '')) = 'credit' THEN 'Credit' ELSE 'Cash' END;
$$ LANGUAGE sql IMMUTABLE;

-- A contact's default account: the primary one, else the oldest. This is the
-- rule resolveSubAccount() has always applied in the client (fix81); writing it
-- here lets the database fill in a row the client left blank.
CREATE OR REPLACE FUNCTION contact_default_sub_account(p_contact UUID)
RETURNS sub_accounts AS $$
  SELECT * FROM sub_accounts
   WHERE contact_id = p_contact
   ORDER BY is_primary DESC NULLS LAST, created_at NULLS LAST, id
   LIMIT 1;
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------------------------
-- 3. EVERY CONTACT GETS AN ACCOUNT
-- -----------------------------------------------------------------------------
-- The order form is about to REQUIRE an account, so a customer without one
-- would be un-orderable. Two paths create contacts without touching
-- sub_accounts: customer_contact_register_with_password (the customer app,
-- fix102) and any direct SQL insert. 11 contacts on this install got in that
-- way, 7 of them with live orders.
--
-- The trigger never blocks the contact: a failed account (a duplicate code, a
-- missing CONTACTS major account) is swallowed, because a contact that cannot
-- be saved is a worse outcome than one whose account is added a minute later.

CREATE OR REPLACE FUNCTION contacts_seed_primary_sub_account()
RETURNS TRIGGER AS $$
DECLARE v_major UUID;
BEGIN
  IF NEW.account_number IS NULL OR btrim(NEW.account_number) = '' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM sub_accounts WHERE contact_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT id INTO v_major FROM major_accounts
   WHERE code = 'CONTACTS' AND company_id IS NOT DISTINCT FROM NEW.company_id
   LIMIT 1;
  IF v_major IS NULL THEN
    SELECT id INTO v_major FROM major_accounts WHERE code = 'CONTACTS' LIMIT 1;
  END IF;
  IF v_major IS NULL THEN RETURN NEW; END IF;   -- fix81 not run; nothing to hang it off

  BEGIN
    INSERT INTO sub_accounts (
      major_account_id, contact_id, code, name, account_type,
      currency, credit_limit, expires_on, is_primary, is_active, description
    ) VALUES (
      v_major, NEW.id, btrim(NEW.account_number), 'Main',
      (CASE WHEN NEW.credit_debit_allowed IS TRUE THEN 'credit' ELSE 'cash' END)::account_type,
      'USD', NULL, NULL, TRUE, TRUE,
      'Created with the contact (fix144).'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- the contact is saved; an account can be added on its Accounts tab
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_seed_sub_account ON contacts;
CREATE TRIGGER trg_contacts_seed_sub_account
  AFTER INSERT OR UPDATE OF account_number ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_seed_primary_sub_account();

-- The contacts that predate the trigger.
INSERT INTO sub_accounts (
  major_account_id, contact_id, code, name, account_type,
  currency, credit_limit, expires_on, is_primary, is_active, description
)
SELECT
  COALESCE(
    (SELECT m.id FROM major_accounts m
      WHERE m.code = 'CONTACTS' AND m.company_id IS NOT DISTINCT FROM c.company_id LIMIT 1),
    (SELECT m.id FROM major_accounts m WHERE m.code = 'CONTACTS' LIMIT 1)
  ),
  c.id,
  btrim(c.account_number),
  'Main',
  (CASE WHEN c.credit_debit_allowed IS TRUE THEN 'credit' ELSE 'cash' END)::account_type,
  'USD', NULL, NULL, TRUE, TRUE,
  'Backfilled from contacts.account_number (fix144).'
FROM contacts c
WHERE c.account_number IS NOT NULL
  AND btrim(c.account_number) <> ''
  AND NOT EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id)
  AND EXISTS (SELECT 1 FROM major_accounts m WHERE m.code = 'CONTACTS')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. AN ORDER RESOLVES AND STAMPS ITS ACCOUNT
-- -----------------------------------------------------------------------------
-- The client sends sub_account_id because the user picked it. This trigger is
-- for every other writer, and for the one thing the client must not be trusted
-- with: deciding the nature. The nature is read from the account itself, so no
-- client can claim an order is Cash while it bills a credit account.

CREATE OR REPLACE FUNCTION delivery_orders_stamp_account()
RETURNS TRIGGER AS $$
DECLARE a sub_accounts%ROWTYPE;
BEGIN
  IF NEW.sub_account_id IS NOT NULL THEN
    SELECT * INTO a FROM sub_accounts WHERE id = NEW.sub_account_id;
  ELSIF NEW.customer_id IS NOT NULL THEN
    a := contact_default_sub_account(NEW.customer_id);
    NEW.sub_account_id := a.id;             -- stays NULL when the contact has none
  END IF;

  IF a.id IS NOT NULL THEN
    NEW.account_nature := account_nature_of(a.account_type::TEXT);
    -- Fill the number when it is blank, and re-fill it whenever the account
    -- itself moves, so the number and the link can never drift apart — which is
    -- exactly how one order ended up naming 421401984866 while pointing at
    -- account 604531933334.
    IF NEW.main_account IS NULL OR btrim(NEW.main_account) = ''
       OR (TG_OP = 'UPDATE' AND NEW.sub_account_id IS DISTINCT FROM OLD.sub_account_id) THEN
      NEW.main_account := a.code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_stamp_account ON delivery_orders;
CREATE TRIGGER trg_orders_stamp_account
  BEFORE INSERT OR UPDATE ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION delivery_orders_stamp_account();

-- -----------------------------------------------------------------------------
-- 5. A PAYMENT INHERITS ITS ORDER'S ACCOUNT
-- -----------------------------------------------------------------------------
-- Whatever the client sends wins; blanks are filled from the order. So the
-- office form, the driver's collection and a back-dated correction all land on
-- the same account without each having to remember to say so.

CREATE OR REPLACE FUNCTION payment_collections_stamp_account()
RETURNS TRIGGER AS $$
DECLARE o delivery_orders%ROWTYPE;
BEGIN
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.sub_account_id IS NOT NULL
     AND NEW.account_nature IS NOT NULL
     AND NEW.main_account IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM delivery_orders WHERE id = NEW.order_id;
  IF o.id IS NULL THEN RETURN NEW; END IF;

  NEW.sub_account_id := COALESCE(NEW.sub_account_id, o.sub_account_id);
  NEW.main_account   := COALESCE(NULLIF(btrim(COALESCE(NEW.main_account, '')), ''), o.main_account);
  NEW.account_nature := COALESCE(NEW.account_nature, o.account_nature);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_stamp_account ON payment_collections;
CREATE TRIGGER trg_payments_stamp_account
  BEFORE INSERT OR UPDATE ON payment_collections
  FOR EACH ROW EXECUTE FUNCTION payment_collections_stamp_account();

-- -----------------------------------------------------------------------------
-- 6. RE-TYPING AN ACCOUNT RESTAMPS ITS OPEN ORDERS
-- -----------------------------------------------------------------------------
-- Turning a customer's cash account into a credit one is a decision about work
-- not yet settled. Orders still open follow it; CLOSED orders keep the nature
-- they were billed and closed under, because that is what the money actually
-- did — a closed statement must not change under the reader.

CREATE OR REPLACE FUNCTION sub_accounts_restamp_open_orders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
    UPDATE delivery_orders
       SET account_nature = account_nature_of(NEW.account_type::TEXT)
     WHERE sub_account_id = NEW.id
       AND isclosed IS DISTINCT FROM TRUE
       AND account_nature IS DISTINCT FROM account_nature_of(NEW.account_type::TEXT);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sub_accounts_restamp_orders ON sub_accounts;
CREATE TRIGGER trg_sub_accounts_restamp_orders
  AFTER UPDATE OF account_type ON sub_accounts
  FOR EACH ROW EXECUTE FUNCTION sub_accounts_restamp_open_orders();

-- -----------------------------------------------------------------------------
-- 7. BACKFILL THE HISTORY
-- -----------------------------------------------------------------------------
-- The same resolution the client has been doing on every read since fix81 —
-- done once, and written down. Orders whose customer still has no account keep
-- a NULL account_nature and are reported by the check at the end.

UPDATE delivery_orders o
   SET sub_account_id = (SELECT (contact_default_sub_account(o.customer_id)).id)
 WHERE o.sub_account_id IS NULL
   AND o.customer_id IS NOT NULL;

-- The number follows the link. Blank ones get filled; a number that names a
-- DIFFERENT account than the one the row points at is corrected, because every
-- balance in the app is computed from the link — so the link is what the order
-- was actually billed to, and the number was the stale half.
UPDATE delivery_orders o
   SET main_account = a.code
  FROM sub_accounts a
 WHERE o.sub_account_id = a.id
   AND (o.main_account IS NULL OR btrim(o.main_account) = '' OR btrim(o.main_account) <> a.code);

UPDATE delivery_orders o
   SET account_nature = account_nature_of(a.account_type::TEXT)
  FROM sub_accounts a
 WHERE o.sub_account_id = a.id
   AND o.account_nature IS DISTINCT FROM account_nature_of(a.account_type::TEXT);

UPDATE payment_collections p
   SET sub_account_id = COALESCE(p.sub_account_id, o.sub_account_id),
       main_account   = COALESCE(NULLIF(btrim(COALESCE(p.main_account, '')), ''), o.main_account),
       account_nature = COALESCE(p.account_nature, o.account_nature)
  FROM delivery_orders o
 WHERE p.order_id = o.id
   AND (p.sub_account_id IS NULL OR p.account_nature IS NULL OR p.main_account IS NULL);

-- -----------------------------------------------------------------------------
-- 8. CHECK — one row, one column per question (the SQL editor shows only the
--    last statement's result, so everything worth knowing is in this SELECT)
-- -----------------------------------------------------------------------------

SELECT
  (SELECT COUNT(*) FROM delivery_orders)                                        AS orders_total,
  (SELECT COUNT(*) FROM delivery_orders WHERE sub_account_id IS NULL)           AS orders_without_account,
  (SELECT COUNT(*) FROM delivery_orders WHERE account_nature IS NULL)           AS orders_without_nature,
  (SELECT COUNT(*) FROM delivery_orders WHERE account_nature = 'Credit')        AS orders_credit,
  (SELECT COUNT(*) FROM delivery_orders WHERE account_nature = 'Cash')          AS orders_cash,
  (SELECT COUNT(*) FROM payment_collections WHERE sub_account_id IS NULL)       AS payments_without_account,
  (SELECT COUNT(*) FROM contacts c WHERE c.account_number IS NOT NULL
     AND btrim(c.account_number) <> ''
     AND NOT EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id))   AS contacts_without_account,
  -- Where the old flag and the new account nature disagree. Neither is "wrong";
  -- the reports now follow the ACCOUNT, so these contacts are the ones to look at.
  (SELECT COUNT(*) FROM contacts c
    WHERE c.credit_debit_allowed IS TRUE
      AND EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id
                        AND s.account_type::TEXT = 'credit'))                   AS flagged_credit_no_credit_account,
  (SELECT COUNT(*) FROM contacts c
    WHERE c.credit_debit_allowed IS NOT TRUE
      AND EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id
                    AND s.account_type::TEXT = 'credit'))                       AS credit_account_not_flagged;
