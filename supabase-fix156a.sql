-- ============================================================================
-- fix156a — add the Senior User role  (STEP 1 OF 2)
-- ----------------------------------------------------------------------------
-- RUN THIS FILE ON ITS OWN, AND NOTHING ELSE WITH IT.
--
-- PostgreSQL will not let a new enum value be USED in the same transaction
-- that adds it, and the Supabase SQL editor sends whatever you run as one
-- transaction. Put the ALTER and the UPDATE in one script and the UPDATE fails
-- with 55P04 "unsafe use of new value" — and because the whole thing is one
-- transaction, the ALTER is rolled back with it and nothing happens at all.
--
-- Hence two files. This one adds the value. Then run fix156b.sql, which
-- assigns it to Clemance.
--
-- Safe to re-run.
-- ============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'senior_user';

-- 'senior_user' must appear in this list before you run fix156b.sql.
SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS user_role_values
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'user_role';
