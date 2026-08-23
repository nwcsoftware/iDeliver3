-- ============================================================================
-- fix134 — deleting a user account for good, with its footprint shown first
-- ----------------------------------------------------------------------------
-- Accounts could be suspended but never removed, so leavers and mistakes piled
-- up forever. Deleting one is not a single DELETE, though: a user's id is
-- stamped across the database — who created an order, who confirmed a payment,
-- who reset a password — and dropping the row without a plan would either fail
-- on a reference or quietly orphan history.
--
-- So there are two functions, and the office always sees the first before it
-- is allowed to run the second:
--
--   admin_user_references(actor, user)  reads every uuid "who did this" column
--                                       in the schema and reports where that
--                                       user appears, and how many times
--   admin_delete_user(actor, user)      does it: the user's OWN records go
--                                       with them, their stamps on everyone
--                                       else's records are set to NULL — the
--                                       order stays, only the name goes — and
--                                       then the account row is deleted
--
-- The scan is by column NAME over information_schema, not a hard-coded list,
-- so a table added next year is covered without anyone remembering to come
-- back here.
--
-- SUPER ADMIN ONLY, and never on: another super admin, or yourself. Deleting
-- the account you are signed in with would lock the door from the inside.
--
-- Safe to run multiple times.
-- ============================================================================

-- ── who may do this ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_super_admin(p_actor_id UUID)
RETURNS public.user_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.user_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.user_accounts WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.status != 'active' OR v_actor.role != 'super_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  RETURN v_actor;
END;
$$;

-- The columns that mean "a user did this". Anything uuid with one of these
-- names is treated as a reference to user_accounts.id.
CREATE OR REPLACE FUNCTION public._user_ref_columns()
RETURNS TABLE (tbl TEXT, col TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.table_name::TEXT, c.column_name::TEXT
  FROM information_schema.columns AS c
  JOIN information_schema.tables  AS t
    ON t.table_schema = c.table_schema
   AND t.table_name   = c.table_name
   AND t.table_type   = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.udt_name = 'uuid'
    AND c.column_name IN (
      'user_id', 'actor_id',
      'created_by', 'updated_by', 'deleted_by', 'added_by', 'removed_by',
      'confirmed_by', 'approved_by', 'rejected_by', 'requested_by',
      'responded_by', 'cancellation_requested_by', 'deactivated_by',
      'collected_by', 'paid_by', 'closed_by', 'opened_by', 'reset_by',
      'assigned_by', 'returned_by', 'sent_by', 'uploaded_by', 'acted_by'
    )
    -- The account's own row is the thing being deleted, not a reference to it.
    AND NOT (c.table_name = 'user_accounts' AND c.column_name = 'id');
$$;

-- ── 1. what would be affected ───────────────────────────────────────────────
-- `kind` says what will happen to those rows on delete:
--   own    — the user's own records (their logbook, sessions): deleted with them
--   audit  — their stamp on someone else's record: set to NULL, record kept
CREATE OR REPLACE FUNCTION public.admin_user_references(p_actor_id UUID, p_user_id UUID)
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

  FOR r IN SELECT * FROM public._user_ref_columns() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.tbl, r.col)
      INTO n USING p_user_id;
    IF n > 0 THEN
      table_name  := r.tbl;
      column_name := r.col;
      rows_found  := n;
      kind := CASE
        WHEN r.tbl LIKE 'user\_%' AND r.col IN ('user_id', 'actor_id') THEN 'own'
        ELSE 'audit'
      END;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. do it ────────────────────────────────────────────────────────────────
-- Returns one row per table touched, so the office can be told exactly what was
-- cleared rather than "done".
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_actor_id UUID, p_user_id UUID)
RETURNS TABLE (table_name TEXT, column_name TEXT, rows_affected BIGINT, action TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor  public.user_accounts%ROWTYPE;
  v_target public.user_accounts%ROWTYPE;
  r RECORD;
  n BIGINT;
BEGIN
  v_actor := public._assert_super_admin(p_actor_id);

  SELECT * INTO v_target FROM public.user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_user_id = p_actor_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF'; END IF;
  IF v_target.role = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_SUPER_ADMIN'; END IF;

  /* Everything below runs in ONE transaction — the function's own. If any
     table refuses (a NOT NULL audit column, a foreign key that restricts),
     nothing at all is deleted and the office is told which table said no,
     rather than being left with a half-removed account. */
  FOR r IN SELECT * FROM public._user_ref_columns() LOOP
    BEGIN
      IF r.tbl LIKE 'user\_%' AND r.col IN ('user_id', 'actor_id') THEN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.tbl, r.col) USING p_user_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          table_name := r.tbl; column_name := r.col; rows_affected := n; action := 'deleted';
          RETURN NEXT;
        END IF;
      ELSE
        -- The work stays; only the name on it goes.
        EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING p_user_id;
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

  DELETE FROM public.user_accounts WHERE id = p_user_id;
  table_name := 'user_accounts'; column_name := 'id'; rows_affected := 1; action := 'deleted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_references(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_user(UUID, UUID)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_references(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID)     TO anon, authenticated;

-- Where a user's id is stamped across this database today.
SELECT tbl AS table_name, col AS column_name FROM public._user_ref_columns() ORDER BY 1, 2;

NOTIFY pgrst, 'reload schema';
