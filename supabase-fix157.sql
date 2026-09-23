-- ============================================================================
-- fix157 — the Senior User rank is called Senior Call Center
-- ----------------------------------------------------------------------------
-- A rename, one day old and held by one account, so it is done properly: the
-- stored value moves with the title rather than leaving 'senior_user' in the
-- database and "Senior Call Center" on the screen. A log line, an export or a
-- support question would otherwise use a word nobody in the office says.
--
-- ALTER TYPE ... RENAME VALUE renames in place. Existing rows are untouched —
-- they already point at this enum member and simply read under its new name —
-- so Clemance keeps her rank without being updated, and nothing has to be
-- re-assigned.
--
-- Unlike ADDING a value, renaming one is safe to use in the same transaction,
-- so this file runs on its own in one go. (fix156 had to be split for exactly
-- that reason.)
--
-- Run once. Safe to re-run: it renames only if the old name is still there.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'user_role' AND e.enumlabel = 'senior_user'
  ) THEN
    ALTER TYPE user_role RENAME VALUE 'senior_user' TO 'senior_call_center';
    RAISE NOTICE 'renamed senior_user -> senior_call_center';
  ELSE
    RAISE NOTICE 'nothing to rename — senior_user is not in user_role';
  END IF;
END $$;

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect senior_call_center in the enum, Clemance holding it, and no row left
-- anywhere on the old name.

SELECT
  (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role')                                              AS user_role_values,
  (SELECT role::TEXT FROM public.user_accounts WHERE username = 'Clemance')     AS clemance_role,
  (SELECT COUNT(*) FROM public.user_accounts
    WHERE role::TEXT = 'senior_call_center')                                    AS senior_call_center_users,
  (SELECT COUNT(*) FROM public.user_accounts WHERE role::TEXT = 'admin')        AS admins_left;

NOTIFY pgrst, 'reload schema';
