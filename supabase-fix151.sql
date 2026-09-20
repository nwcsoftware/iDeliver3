-- ============================================================================
-- fix151 — deleting a retired contact for good, with everything attached shown
--          first
-- ----------------------------------------------------------------------------
-- Deactivating a contact hides it. It does not remove it: the row stays, its
-- account number stays, its orders stay, and a super admin can bring it back.
-- That is the right default, and nothing here changes it.
--
-- What was missing is the last step. A contact retired years ago, settled and
-- never coming back, could only be deleted by the plain DELETE on the Contacts
-- page — which the database refuses the moment anything still points at the
-- row. So the office was told "can't delete, still linked to orders" and had
-- no way to see WHAT, or to decide about it.
--
-- This is the same shape as the driver deletion in fix138, which it borrows
-- outright:
--
--   admin_contact_references(actor, contact)          what is attached
--   admin_delete_contact(actor, contact, orders?)     does it, and reports back
--
-- THREE RULES THIS ENFORCES, AND THEY ARE NOT THE SCREEN'S TO RELAX:
--
--   1. Super admin only.
--   2. THE CONTACT MUST ALREADY BE DEACTIVATED. Retiring a contact runs a
--      settlement check — open orders, unpaid package dues, an uncollected
--      balance — and refuses while any of it stands. Making deletion reachable
--      only through deactivation means that check can never be walked around:
--      you cannot delete what you could not first retire.
--   3. Not the contact behind the account you are signed in with.
--
-- ORDERS ARE THE CALLER'S DECISION. delivery_orders.customer_id is NOT NULL,
-- so an order cannot outlive its customer — keeping the orders and emptying
-- the name is not on the table. Either the orders go with the contact, or the
-- contact stays. The review shows the count and the screen makes it an
-- explicit tick; this function will not guess. When they do go, they go
-- through delete_orders_by_ids, the same routine a single deleted order takes,
-- so items, services, packages, payments and ledger lines are handled exactly
-- as they always are.
--
-- WHAT COUNTS AS THEIR OWN. An account number, a subscription, a payout we
-- made them, their addresses, their shop's stock — these exist only because
-- the contact does, and are deleted with it. A reference to them on somebody
-- ELSE'S record — a package they provided on another customer's order — is
-- emptied, and that record is kept: it is not ours to destroy.
--
-- As in fix138 the scan is discovered from the schema, so a table added next
-- year is covered without anyone editing this file.
--
-- Requires fix76 (delete_orders_by_ids), fix134/135 (_assert_super_admin,
-- admin_delete_user) and fix138 (_contact_ref_columns).
--
-- Safe to run multiple times.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_contact_references(UUID, UUID);
DROP FUNCTION IF EXISTS public.admin_delete_contact(UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public._contact_delete_kind(TEXT, TEXT, BOOLEAN, TEXT);

-- ── how each reference is treated ───────────────────────────────────────────
-- One place, so the review and the delete can never disagree about what is
-- about to happen. This is the contact-shaped sibling of _driver_ref_kind:
-- a driver is only ever ours, while a contact is a counterparty, so the line
-- between "their own record" and "somebody else's record" falls differently.
CREATE FUNCTION public._contact_delete_kind(
  p_tbl TEXT, p_col TEXT, p_nullable BOOLEAN, p_del TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- Their login. admin_delete_user takes that apart properly.
    WHEN p_tbl = 'user_accounts' AND p_col = 'contact_id'         THEN 'account'

    -- The orders they placed. NOT NULL, so these cannot be orphaned — the
    -- caller either takes them too or the contact stays.
    WHEN p_tbl = 'delivery_orders' AND p_col = 'customer_id'      THEN 'orders'

    /* Records that exist only because this contact does. Named explicitly
       rather than left to the nullable test below, because several of them
       ARE nullable and would otherwise be emptied instead of removed —
       leaving an account number with no owner sitting in the Chart of
       Accounts, or a payout addressed to nobody. */
    WHEN p_tbl IN ('sub_accounts', 'subscriptions', 'partner_payouts',
                   'credit_customer_payments', 'shop_inventory',
                   'supplier_settlements', 'supplier_commissions')  THEN 'own'
    WHEN p_tbl LIKE 'contact\_%'                                  THEN 'own'
    WHEN p_tbl LIKE 'supplier_partner%'                           THEN 'own'
    WHEN p_col = 'employee_id'                                    THEN 'own'
    -- A key the schema itself says cascades: the database already considers
    -- this row dependent.
    WHEN p_del = 'c'                                              THEN 'own'

    -- A mention of them on a record that is NOT theirs — a package they
    -- supplied for another customer, an item they were the supplier of. The
    -- name is emptied; the record belongs to somebody else and stays.
    WHEN p_nullable OR p_del = 'n'                                THEN 'audit'

    -- A NOT NULL reference on a record that is not theirs. Nothing can be
    -- done with it without destroying real work, so it stops the delete up
    -- front rather than failing halfway through.
    ELSE 'blocking'
  END;
$$;

-- ── 1. what is attached ─────────────────────────────────────────────────────
CREATE FUNCTION public.admin_contact_references(p_actor_id UUID, p_contact_id UUID)
RETURNS TABLE (table_name TEXT, column_name TEXT, rows_found BIGINT, kind TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r RECORD;
  n BIGINT;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);

  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND';
  END IF;

  FOR r IN SELECT * FROM public._contact_ref_columns() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.tbl, r.col)
      INTO n USING p_contact_id;
    IF n > 0 THEN
      table_name  := r.tbl;
      column_name := r.col;
      rows_found  := n;
      kind        := public._contact_delete_kind(r.tbl, r.col, r.nullable, r.del);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. do it ────────────────────────────────────────────────────────────────
-- p_delete_orders must be TRUE when the contact has orders; there is no way to
-- keep them (see the header). Passing FALSE with orders present refuses.
CREATE FUNCTION public.admin_delete_contact(
  p_actor_id      UUID,
  p_contact_id    UUID,
  p_delete_orders BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (table_name TEXT, column_name TEXT, rows_affected BIGINT, action TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contact  public.contacts%ROWTYPE;
  v_actor    public.user_accounts%ROWTYPE;
  v_user_id  UUID;
  v_orders   UUID[];
  v_result   JSONB;
  v_name     TEXT;
  r RECORD;
  n BIGINT;
BEGIN
  v_actor := public._assert_super_admin(p_actor_id);

  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND'; END IF;

  /* Deactivation is the gate, and it is a real one. Retiring a contact runs a
     settlement check first; allowing a live contact to be deleted here would
     be a way straight past it. */
  IF v_contact.is_active IS NOT FALSE THEN
    RAISE EXCEPTION 'CONTACT_IS_ACTIVE';
  END IF;

  v_name := COALESCE(NULLIF(TRIM(v_contact.company_name), ''),
                     NULLIF(TRIM(CONCAT_WS(' ', v_contact.first_name, v_contact.last_name)), ''),
                     v_contact.code, p_contact_id::TEXT);

  -- Not the card behind the door you came in through.
  IF v_actor.contact_id IS NOT NULL AND v_actor.contact_id = p_contact_id THEN
    RAISE EXCEPTION 'CANNOT_DELETE_SELF';
  END IF;

  SELECT array_agg(id) INTO v_orders FROM public.delivery_orders WHERE customer_id = p_contact_id;

  IF v_orders IS NOT NULL AND array_length(v_orders, 1) > 0 AND NOT p_delete_orders THEN
    RAISE EXCEPTION 'ORDERS_NOT_CONFIRMED:% order(s) belong to this contact and cannot outlive it', array_length(v_orders, 1);
  END IF;

  /* ── pre-flight ──────────────────────────────────────────────────────────
     Anything untouchable stops the whole thing BEFORE a single row moves, so
     a contact is never left half-deleted. */
  FOR r IN SELECT * FROM public._contact_ref_columns() LOOP
    IF public._contact_delete_kind(r.tbl, r.col, r.nullable, r.del) = 'blocking' THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.tbl, r.col)
        INTO n USING p_contact_id;
      IF n > 0 THEN
        RAISE EXCEPTION 'BLOCKED_BY:%.% holds % row(s) that must keep a contact and are not this one''s own',
          r.tbl, r.col, n;
      END IF;
    END IF;
  END LOOP;

  -- One audit line for the whole removal, written while the contact still exists.
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action,
                            transaction_description, old_values)
    VALUES (v_contact.company_id, p_actor_id, 'contacts', p_contact_id, 'DELETE',
            format('Deleted retired contact %s (%s) permanently — %s order(s) went with it.',
                   v_name, COALESCE(v_contact.code, '—'),
                   COALESCE(array_length(v_orders, 1), 0)),
            to_jsonb(v_contact));
  END IF;

  /* ── 1. their orders ─────────────────────────────────────────────────── */
  IF v_orders IS NOT NULL AND array_length(v_orders, 1) > 0 THEN
    v_result := public.delete_orders_by_ids(v_orders, p_actor_id);
    table_name := 'delivery_orders'; column_name := 'customer_id';
    rows_affected := COALESCE((v_result->>'orders')::BIGINT, 0); action := 'deleted';
    RETURN NEXT;
  END IF;

  /* ── 2. their login ──────────────────────────────────────────────────── */
  SELECT id INTO v_user_id FROM public.user_accounts WHERE contact_id = p_contact_id;
  IF v_user_id IS NOT NULL THEN
    IF v_user_id = p_actor_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF'; END IF;
    FOR r IN SELECT * FROM public.admin_delete_user(p_actor_id, v_user_id) LOOP
      table_name := r.table_name; column_name := r.column_name;
      rows_affected := r.rows_affected; action := r.action;
      RETURN NEXT;
    END LOOP;
  END IF;

  /* ── 3. everything else that points at them ──────────────────────────── */
  /* sub_accounts goes LAST. An account number is pointed at by orders, by
     payments and by credit settlements, so emptying it first would hit a
     foreign key on rows this loop has not reached yet and report a block that
     is really just an ordering accident. Everything that can reference an
     account is cleared before the account itself. */
  FOR r IN SELECT * FROM public._contact_ref_columns()
            ORDER BY (tbl = 'sub_accounts'), tbl, col LOOP
    CONTINUE WHEN (r.tbl = 'delivery_orders' AND r.col = 'customer_id');
    CONTINUE WHEN (r.tbl = 'user_accounts'   AND r.col = 'contact_id');
    BEGIN
      IF public._contact_delete_kind(r.tbl, r.col, r.nullable, r.del) = 'own' THEN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.tbl, r.col) USING p_contact_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          table_name := r.tbl; column_name := r.col; rows_affected := n; action := 'deleted';
          RETURN NEXT;
        END IF;
      ELSE
        EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING p_contact_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          table_name := r.tbl; column_name := r.col; rows_affected := n; action := 'cleared';
          RETURN NEXT;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'BLOCKED_BY:%.%: %', r.tbl, r.col, SQLERRM;
    END;
  END LOOP;

  /* ── 4. the contact itself ───────────────────────────────────────────── */
  DELETE FROM public.contacts WHERE id = p_contact_id;
  table_name := 'contacts'; column_name := 'id'; rows_affected := 1; action := 'deleted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_contact_references(UUID, UUID)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_contact(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_contact_references(UUID, UUID)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_contact(UUID, UUID, BOOLEAN) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── check ───────────────────────────────────────────────────────────────────
-- Left: what a contact delete would refuse to touch in this database, if
-- anything. An empty result is the healthy answer.
-- Right: the retired contacts this tool will list.
SELECT tbl AS blocking_table, col AS blocking_column
FROM public._contact_ref_columns()
WHERE public._contact_delete_kind(tbl, col, nullable, del) = 'blocking'
ORDER BY 1, 2;

SELECT COUNT(*) AS retired_contacts_listed
FROM public.contacts WHERE is_active IS FALSE;
