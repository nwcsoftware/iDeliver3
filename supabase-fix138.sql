-- ============================================================================
-- fix138 — deleting a driver for good, with everything attached shown first
-- ----------------------------------------------------------------------------
-- A driver is a `contacts` row, and that row is pointed at from all over the
-- database: the orders they carried, their petty cash, their vehicle
-- assignments, their daily settlements, their GPS trail, and — when they have
-- a login — a `user_accounts` row that is itself stamped across the schema.
-- Deleting the contact on its own either fails on a foreign key or leaves
-- orphans behind, which is why drivers could only ever be deactivated.
--
-- Two functions, and the office always sees the first before it may run the
-- second — the same shape as the user deletion in fix134/135:
--
--   admin_driver_references(actor, driver)      what is attached, and what
--                                               would happen to each of it
--   admin_delete_driver(actor, driver, orders?) does it, and reports back
--
-- What happens to each kind of record:
--
--   own       rows that exist only because of this driver — petty cash,
--             settlements, vehicle assignments, their addresses — deleted
--   orders    the orders they carried. THE CALLER CHOOSES: delete each order
--             and everything on it (reusing delete_orders_by_ids, so items,
--             services, packages, payments and ledger lines go the same way a
--             single deleted order does), or keep the orders and only take the
--             driver's name off them
--   account   their login, if any — handed to admin_delete_user, so their own
--             user rows go and their stamps on other people's work are cleared
--   audit     a nullable reference on somebody else's record — cleared, the
--             record itself kept
--   own       (also) their payroll: salary_records.employee_id is NOT NULL,
--             and a payslip belongs to the person it paid
--   blocking  a NOT NULL reference on a record that is not the driver's own.
--             Nothing can be done with it without destroying real work, so it
--             is reported in the review and refuses the delete up front rather
--             than failing halfway through.
--
-- The scan is discovered from the schema — every foreign key that points at
-- contacts(id), plus any uuid column named like a contact reference — so a
-- table added next year is covered without anyone editing this file.
--
-- SUPER ADMIN ONLY. Requires fix76 (delete_orders_by_ids) and fix134/135
-- (_assert_super_admin, admin_delete_user).
--
-- Safe to run multiple times.
-- ============================================================================

-- ── every column that can point at a contact ────────────────────────────────
-- Foreign keys first (authoritative, and they carry the ON DELETE rule), then
-- likely-looking uuid columns that were created without a key. `del` is the
-- foreign key's ON DELETE action: 'c' cascade, 'n' set null, 'a'/'r' neither.
-- It is carried as TEXT: pg_constraint.confdeltype is the internal "char"
-- type, which is NOT the same as CHAR (bpchar) and will not match a column
-- declared that way.
DROP FUNCTION IF EXISTS public.admin_driver_references(UUID, UUID);
DROP FUNCTION IF EXISTS public.admin_delete_driver(UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public._contact_ref_columns();
DROP FUNCTION IF EXISTS public._driver_ref_kind(TEXT, TEXT, BOOLEAN, CHAR);
DROP FUNCTION IF EXISTS public._driver_ref_kind(TEXT, TEXT, BOOLEAN, TEXT);

CREATE FUNCTION public._contact_ref_columns()
RETURNS TABLE (tbl TEXT, col TEXT, nullable BOOLEAN, del TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH fks AS (
    SELECT c.conrelid::regclass::TEXT           AS tbl,
           a.attname::TEXT                      AS col,
           NOT a.attnotnull                     AS nullable,
           c.confdeltype::TEXT                  AS del
    FROM pg_constraint AS c
    JOIN pg_attribute  AS a
      ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.contacts'::regclass
      AND c.connamespace = 'public'::regnamespace
      AND array_length(c.conkey, 1) = 1
  ),
  named AS (
    SELECT c.table_name::TEXT      AS tbl,
           c.column_name::TEXT     AS col,
           (c.is_nullable = 'YES') AS nullable,
           NULL::TEXT              AS del
    FROM information_schema.columns AS c
    JOIN information_schema.tables  AS t
      ON t.table_schema = c.table_schema
     AND t.table_name   = c.table_name
     AND t.table_type   = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.udt_name = 'uuid'
      AND c.column_name IN (
        'driver_id', 'contact_id', 'customer_id', 'provider_id', 'partner_id',
        'supplier_id', 'recipient_id', 'owner_contact_id', 'customer_contact_id',
        'party_id', 'second_party_id', 'sender_id'
      )
  ),
  -- `all_refs`, not `both`: BOTH is a reserved word (trim(both …)) and cannot
  -- name a CTE.
  all_refs AS (
    SELECT * FROM fks
    UNION
    SELECT n.* FROM named AS n
    WHERE NOT EXISTS (SELECT 1 FROM fks AS f WHERE f.tbl = n.tbl AND f.col = n.col)
  )
  -- The contact row itself is deleted last, by name, not through this list.
  SELECT tbl, col, nullable, del FROM all_refs WHERE tbl <> 'contacts';
$$;

-- How each reference is treated. One place, so the review and the delete can
-- never disagree about what is about to happen.
CREATE FUNCTION public._driver_ref_kind(
  p_tbl TEXT, p_col TEXT, p_nullable BOOLEAN, p_del TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- Their login. admin_delete_user takes that apart properly.
    WHEN p_tbl = 'user_accounts' AND p_col = 'contact_id'        THEN 'account'
    -- The orders they carried — the caller decides these.
    WHEN p_tbl = 'delivery_orders' AND p_col = 'driver_id'       THEN 'orders'
    -- Their pay. `salary_records.employee_id` is NOT NULL, so without this it
    -- would block the delete outright — and a driver who has ever been paid is
    -- every driver. A payslip carrying their delivery count and earnings is
    -- theirs and nobody else's, so it goes with them (and the review shows the
    -- count first).
    WHEN p_col = 'employee_id'                                   THEN 'own'
    -- Rows that exist only because this contact does.
    WHEN p_tbl LIKE 'driver%' OR p_tbl LIKE 'contact\_%'
      OR p_tbl LIKE 'supplier_partner%' OR p_del = 'c'           THEN 'own'
    -- A reference that can simply be emptied.
    WHEN p_nullable OR p_del = 'n'                               THEN 'audit'
    -- A NOT NULL reference on somebody else's record: untouchable.
    ELSE 'blocking'
  END;
$$;

-- ── 1. what is attached ─────────────────────────────────────────────────────
CREATE FUNCTION public.admin_driver_references(p_actor_id UUID, p_driver_id UUID)
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

  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_driver_id) THEN
    RAISE EXCEPTION 'DRIVER_NOT_FOUND';
  END IF;

  FOR r IN SELECT * FROM public._contact_ref_columns() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.tbl, r.col)
      INTO n USING p_driver_id;
    IF n > 0 THEN
      table_name  := r.tbl;
      column_name := r.col;
      rows_found  := n;
      kind        := public._driver_ref_kind(r.tbl, r.col, r.nullable, r.del);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. do it ────────────────────────────────────────────────────────────────
-- p_delete_orders = TRUE  the driver's orders are deleted whole
--                   FALSE the orders are kept and simply lose their driver
CREATE FUNCTION public.admin_delete_driver(
  p_actor_id      UUID,
  p_driver_id     UUID,
  p_delete_orders BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (table_name TEXT, column_name TEXT, rows_affected BIGINT, action TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_driver   public.contacts%ROWTYPE;
  v_actor    public.user_accounts%ROWTYPE;
  v_user_id  UUID;
  v_orders   UUID[];
  v_result   JSONB;
  v_name     TEXT;
  r RECORD;
  n BIGINT;
BEGIN
  v_actor := public._assert_super_admin(p_actor_id);

  SELECT * INTO v_driver FROM public.contacts WHERE id = p_driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRIVER_NOT_FOUND'; END IF;

  -- A driver, and only a driver. A contact who also sells or buys is somebody
  -- else's counterparty too, and removing them here would take that with it.
  IF v_driver.contact_type::TEXT <> 'driver' THEN
    RAISE EXCEPTION 'NOT_A_DRIVER';
  END IF;

  v_name := COALESCE(NULLIF(TRIM(CONCAT_WS(' ', v_driver.first_name, v_driver.last_name)), ''),
                     v_driver.company_name, v_driver.code, p_driver_id::TEXT);

  -- The signed-in super admin's own contact card is not a door to close from
  -- the inside.
  IF v_actor.contact_id IS NOT NULL AND v_actor.contact_id = p_driver_id THEN
    RAISE EXCEPTION 'CANNOT_DELETE_SELF';
  END IF;

  /* ── pre-flight ──────────────────────────────────────────────────────────
     Anything untouchable stops the whole thing BEFORE a single row moves, so
     a driver is never left half-deleted. */
  FOR r IN SELECT * FROM public._contact_ref_columns() LOOP
    IF public._driver_ref_kind(r.tbl, r.col, r.nullable, r.del) = 'blocking' THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.tbl, r.col)
        INTO n USING p_driver_id;
      IF n > 0 THEN
        RAISE EXCEPTION 'BLOCKED_BY:%.% holds % row(s) that must keep a contact and are not this driver''s own',
          r.tbl, r.col, n;
      END IF;
    END IF;
  END LOOP;

  -- One audit line for the whole removal, written while the driver still exists.
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action,
                            transaction_description, old_values)
    VALUES (v_driver.company_id, p_actor_id, 'contacts', p_driver_id, 'DELETE',
            format('Deleted driver %s (%s) permanently — orders were %s.',
                   v_name, COALESCE(v_driver.code, '—'),
                   CASE WHEN p_delete_orders THEN 'deleted with them' ELSE 'kept and unassigned' END),
            to_jsonb(v_driver));
  END IF;

  /* ── 1. the orders they carried ──────────────────────────────────────── */
  SELECT array_agg(id) INTO v_orders FROM public.delivery_orders WHERE driver_id = p_driver_id;
  IF v_orders IS NOT NULL AND array_length(v_orders, 1) > 0 THEN
    IF p_delete_orders THEN
      -- The same routine a single deleted order goes through, so items,
      -- services, packages, payments and ledger lines are handled identically.
      v_result := public.delete_orders_by_ids(v_orders, p_actor_id);
      table_name := 'delivery_orders'; column_name := 'driver_id';
      rows_affected := COALESCE((v_result->>'orders')::BIGINT, 0); action := 'deleted';
      RETURN NEXT;
    ELSE
      UPDATE public.delivery_orders SET driver_id = NULL WHERE driver_id = p_driver_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      table_name := 'delivery_orders'; column_name := 'driver_id';
      rows_affected := n; action := 'unassigned';
      RETURN NEXT;
    END IF;
  END IF;

  /* ── 2. their login ──────────────────────────────────────────────────── */
  SELECT id INTO v_user_id FROM public.user_accounts WHERE contact_id = p_driver_id;
  IF v_user_id IS NOT NULL THEN
    IF v_user_id = p_actor_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF'; END IF;
    FOR r IN SELECT * FROM public.admin_delete_user(p_actor_id, v_user_id) LOOP
      table_name := r.table_name; column_name := r.column_name;
      rows_affected := r.rows_affected; action := r.action;
      RETURN NEXT;
    END LOOP;
  END IF;

  /* ── 3. everything else that points at them ──────────────────────────── */
  FOR r IN SELECT * FROM public._contact_ref_columns() LOOP
    CONTINUE WHEN (r.tbl = 'delivery_orders' AND r.col = 'driver_id');
    CONTINUE WHEN (r.tbl = 'user_accounts'   AND r.col = 'contact_id');
    BEGIN
      IF public._driver_ref_kind(r.tbl, r.col, r.nullable, r.del) = 'own' THEN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.tbl, r.col) USING p_driver_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          table_name := r.tbl; column_name := r.col; rows_affected := n; action := 'deleted';
          RETURN NEXT;
        END IF;
      ELSE
        EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING p_driver_id;
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

  /* ── 4. the driver themselves ────────────────────────────────────────── */
  DELETE FROM public.contacts WHERE id = p_driver_id;
  table_name := 'contacts'; column_name := 'id'; rows_affected := 1; action := 'deleted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_driver_references(UUID, UUID)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_driver(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_driver_references(UUID, UUID)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_driver(UUID, UUID, BOOLEAN) TO anon, authenticated;

-- What a driver delete would refuse to touch, if anything, in this database.
SELECT tbl AS table_name, col AS column_name
FROM public._contact_ref_columns()
WHERE public._driver_ref_kind(tbl, col, nullable, del) = 'blocking'
ORDER BY 1, 2;

NOTIFY pgrst, 'reload schema';
