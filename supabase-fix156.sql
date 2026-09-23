-- ============================================================================
-- fix156 — a Senior User: an administrator, minus what comes later
-- ----------------------------------------------------------------------------
-- A rank between admin and call centre. For now it can do everything an
-- administrator can; the point of creating it is that a list of exceptions is
-- coming, and those exceptions need somewhere to be subtracted FROM.
--
-- Starting it as a full administrator rather than as a new set of permissions
-- is deliberate. Nobody is locked out of work they did yesterday, and when the
-- list arrives each item is one visible removal instead of a guess about what
-- was never granted.
--
-- Clemance moves first, and alone. Elie, Lara and jad stay administrators.
--
-- ── RUN THIS IN TWO PARTS ───────────────────────────────────────────────────
-- PostgreSQL will not let a new enum value be USED in the same transaction
-- that adds it, and the SQL editor sends a whole script as one transaction. So
-- part 1 adds the value, and part 2 — run separately, after part 1 succeeds —
-- assigns it. Running the whole file at once fails on part 2 with
-- "unsafe use of new value of enum type", and part 1 will already have worked.
--
-- Safe to re-run: both parts are conditional.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — select and run THIS BLOCK ONLY, first
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'senior_user';

-- Confirm before going on: 'senior_user' must be in this list.
SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS user_role_values
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'user_role';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — run this only after part 1 has committed
-- ════════════════════════════════════════════════════════════════════════════

-- Who is about to move, listed before they do.
SELECT id, username, role::TEXT AS role_now, 'senior_user' AS role_after, status
  FROM public.user_accounts
 WHERE username = 'Clemance';

UPDATE public.user_accounts
   SET role       = 'senior_user',
       updated_at = NOW()
 WHERE username = 'Clemance'
   AND role::TEXT = 'admin';        -- no-op if already moved, or never an admin

-- One audit line, so a change of rank is not something that just appears.
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
  (SELECT role::TEXT FROM public.user_accounts WHERE username = 'Clemance')   AS clemance_role,
  (SELECT COUNT(*) FROM public.user_accounts WHERE role::TEXT = 'admin')      AS admins_left,
  (SELECT COUNT(*) FROM public.user_accounts WHERE role::TEXT = 'senior_user') AS senior_users,
  (SELECT string_agg(username, ', ' ORDER BY username)
     FROM public.user_accounts WHERE role::TEXT IN ('admin', 'senior_user'))  AS who;

NOTIFY pgrst, 'reload schema';
