-- ============================================================================
-- fix135 — user deletion: own records are recognised by the column, and a
--          blocking reference is predicted instead of discovered
-- ----------------------------------------------------------------------------
-- fix134 decided what belonged to a user by TABLE NAME: `user_logbook` and
-- friends were theirs, everything else was a stamp on someone else's record.
-- That was too narrow. `broadcast_message_reads.user_id` is a read receipt —
-- as much the user's own row as their logbook — but the table is not called
-- user_something, so the delete tried to NULL it and hit a not-null column.
--
-- The column says it better than the table does:
--
--   user_id      this row IS that user's — deleted with the account
--   *_by, actor_id  someone's name ON another record — cleared, record kept
--
-- And a `*_by` column that is NOT NULL can never be cleared, so an account
-- referenced there cannot be deleted at all. fix134 found that out by trying;
-- now the scan reports it up front, so the office sees "this blocks the
-- delete" in the review rather than an error after pressing the button.
--
-- Safe to run multiple times: the three functions are dropped and recreated.
-- Requires fix134, whose _assert_super_admin it keeps and reuses.
-- ============================================================================

/* Dropped rather than replaced: this one gains a `nullable` column, and
   PostgreSQL refuses to change the shape of what a function returns in place
   (42P13). The two callers below are recreated straight after, and a function
   body is only resolved when it runs, so the gap is harmless. */
DROP FUNCTION IF EXISTS public.admin_user_references(UUID, UUID);
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID, UUID);
DROP FUNCTION IF EXISTS public._user_ref_columns();

CREATE FUNCTION public._user_ref_columns()
RETURNS TABLE (tbl TEXT, col TEXT, nullable BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.table_name::TEXT,
         c.column_name::TEXT,
         (c.is_nullable = 'YES')
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
    AND NOT (c.table_name = 'user_accounts' AND c.column_name = 'id');
$$;

-- ── 1. what would be affected ───────────────────────────────────────────────
--   own      the user's own rows — deleted with the account
--   audit    their name on another record — cleared, the record kept
--   blocking their name on another record in a column that refuses NULL —
--            nothing can be done with it, so the delete cannot proceed
CREATE FUNCTION public.admin_user_references(p_actor_id UUID, p_user_id UUID)
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
        WHEN r.col = 'user_id'  THEN 'own'
        WHEN NOT r.nullable     THEN 'blocking'
        ELSE 'audit'
      END;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. do it ────────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_delete_user(p_actor_id UUID, p_user_id UUID)
RETURNS TABLE (table_name TEXT, column_name TEXT, rows_affected BIGINT, action TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target public.user_accounts%ROWTYPE;
  r RECORD;
  n BIGINT;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);

  SELECT * INTO v_target FROM public.user_accounts WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_user_id = p_actor_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF'; END IF;
  IF v_target.role = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_SUPER_ADMIN'; END IF;

  /* Pre-flight: a name stamped in a column that refuses NULL cannot be
     removed, and deleting the record it sits on would take a real piece of the
     business with it. Refuse before touching anything, naming what stopped it,
     so the account is never left half-removed. */
  FOR r IN SELECT * FROM public._user_ref_columns() WHERE col <> 'user_id' AND NOT nullable LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.tbl, r.col)
      INTO n USING p_user_id;
    IF n > 0 THEN
      RAISE EXCEPTION 'BLOCKED_BY:%.% holds % row(s) and cannot be emptied (the column does not allow NULL)',
        r.tbl, r.col, n;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM public._user_ref_columns() LOOP
    BEGIN
      IF r.col = 'user_id' THEN
        -- The user's own rows: receipts, sessions, their log.
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

-- Which stamp columns refuse NULL — these are the ones that can block a delete.
SELECT tbl AS table_name, col AS column_name
FROM public._user_ref_columns()
WHERE col <> 'user_id' AND NOT nullable
ORDER BY 1, 2;

NOTIFY pgrst, 'reload schema';
