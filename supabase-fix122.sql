-- ============================================================================
-- fix122 — every view respects the caller's permissions (Security Definer View)
-- ----------------------------------------------------------------------------
-- Supabase's linter flags each of our views as CRITICAL "Security Definer View":
--
--   public.account_transaction_summary_view   (fix39)
--   public.v_credit_customer_balances         (fix52 / schema)
--   public.v_daily_order_summary              (schema)
--   public.v_driver_due_to_pay                (fix86 / fix90)
--   public.v_supplier_settlements             (fix71)
--
-- Why: a Postgres view runs, by default, with the permissions of whoever
-- CREATED it — the `postgres` superuser — not of whoever queries it. Because
-- these views are granted to `anon`, anyone holding the public key can read
-- every row they return, and the row-level security on the tables underneath
-- (orders, payments, contacts, drivers…) is bypassed entirely. That is a hole
-- straight past RLS, hence "critical" rather than a warning.
--
-- The fix: `security_invoker = on` (PostgreSQL 15+, which Supabase runs) makes
-- a view execute with the PERMISSIONS OF THE CALLER. Each view then returns
-- exactly the rows that caller could have selected from the base tables itself.
--
-- Nothing breaks in this app: `anon` already holds permissive dev policies on
-- the underlying tables, so every page keeps reading what it read before. When
-- those policies are eventually tightened for production, the views tighten
-- with them — which is the whole point.
--
-- The loop covers every view in `public`, so any view added later is corrected
-- by re-running this file. Safe to run multiple times.
-- ============================================================================

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v.viewname);
    RAISE NOTICE 'security_invoker set on public.%', v.viewname;
  END LOOP;
END $$;

-- The grants stay: `anon` still needs SELECT on the views themselves. What
-- changes is that a view no longer lends it the owner's rights on the tables
-- beneath it.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', v.viewname);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Check afterwards — every row should read `security_invoker=on`:
--
--   SELECT c.relname,
--          COALESCE(array_to_string(c.reloptions, ', '), '(none)') AS options
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE c.relkind = 'v' AND n.nspname = 'public'
--   ORDER BY c.relname;
