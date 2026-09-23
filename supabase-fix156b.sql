-- ============================================================================
-- fix156b — make Clemance a Senior User  (STEP 2 OF 2)
-- ----------------------------------------------------------------------------
-- Run fix156a.sql FIRST and let it finish. This file uses the enum value that
-- one adds, and PostgreSQL refuses a value added in the same transaction.
--
-- A Senior User is a rank between admin and call centre. For now it can do
-- everything an administrator can; the point of creating it is that a list of
-- exceptions is coming, and those exceptions need something to be subtracted
-- FROM. Starting it as a full administrator means nobody loses work they did
-- yesterday, and each exception later is one visible removal rather than a
-- guess about what was never granted.
--
-- Clemance moves, and alone. Elie, Lara and jad stay administrators: four
-- administrators become three, plus one senior user.
--
-- Safe to re-run: the update is conditional and the audit line is written once.
-- ============================================================================

-- Who is about to move, listed before they do.
SELECT id, username, role::TEXT AS role_now, 'senior_user' AS role_after, status
  FROM public.user_accounts
 WHERE username = 'Clemance';

UPDATE public.user_accounts
   SET role       = 'senior_user',
       updated_at = NOW()
 WHERE username = 'Clemance'
   AND role::TEXT = 'admin';        -- no-op if already moved, or never an admin

-- One audit line, so a change of rank is not something that merely appears.
INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action,
                        transaction_description, new_values)
SELECT u.company_id, u.id, 'user_accounts', u.id, 'UPDATE',
       'Role changed from Admin to Senior User (fix156).',
       jsonb_build_object('role', 'senior_user')
  FROM public.user_accounts u
 WHERE u.username = 'Clemance'
   AND u.role::TEXT = 'senior_user'
   AND to_regclass('public.audit_logs') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM audit_logs a
      WHERE a.record_id = u.id
        AND a.transaction_description = 'Role changed from Admin to Senior User (fix156).');

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: clemance_role = senior_user, admins_left = 3, senior_users = 1.

SELECT
  (SELECT role::TEXT FROM public.user_accounts WHERE username = 'Clemance')    AS clemance_role,
  (SELECT COUNT(*) FROM public.user_accounts WHERE role::TEXT = 'admin')       AS admins_left,
  (SELECT COUNT(*) FROM public.user_accounts WHERE role::TEXT = 'senior_user') AS senior_users,
  (SELECT string_agg(username, ', ' ORDER BY username)
     FROM public.user_accounts WHERE role::TEXT IN ('admin', 'senior_user'))   AS who;

NOTIFY pgrst, 'reload schema';
