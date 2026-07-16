-- fix81 verification — ONE query, one result row.
--
-- The Supabase SQL editor only displays the LAST statement's result, so this is
-- deliberately a single SELECT: every check is a column, all visible at once.
-- Read-only. Runs as postgres, which RLS does not filter, so it shows what is
-- really in the tables regardless of policies.
--
-- Expected AFTER running supabase-fix81.sql:
--   contacts_major        1   (the CONTACTS parent, one per company)
--   contact_accounts      = contacts_with_number
--   backfill_remaining    0
--   sub_accounts_rls / major_accounts_rls    true
--   sub_accounts_policies / major_accounts_policies   >= 1   <-- the anon policy
--   junk_columns          0   (nothing left from the broken early revisions)

SELECT
  (SELECT count(*) FROM major_accounts)                             AS major_accounts,
  (SELECT count(*) FROM major_accounts WHERE code = 'CONTACTS')     AS contacts_major,
  (SELECT count(*) FROM sub_accounts)                               AS sub_accounts_total,
  (SELECT count(*) FROM sub_accounts WHERE contact_id IS NOT NULL)  AS contact_accounts,
  (SELECT count(*) FROM sub_accounts WHERE is_primary)              AS primary_accounts,
  (SELECT count(*) FROM contacts
     WHERE account_number IS NOT NULL AND btrim(account_number) <> '') AS contacts_with_number,

  -- Contacts that still have no account. Expect 0 after a full run.
  (SELECT count(*) FROM contacts c
     WHERE c.account_number IS NOT NULL AND btrim(c.account_number) <> ''
       AND NOT EXISTS (SELECT 1 FROM sub_accounts s WHERE s.contact_id = c.id))
                                                                    AS backfill_remaining,

  -- RLS: enabled with >= 1 policy means the app's anon key can reach the table.
  -- Enabled with 0 policies is the silent-empty-read trap.
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'sub_accounts' AND relnamespace = 'public'::regnamespace)
                                                                    AS sub_accounts_rls,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'sub_accounts')    AS sub_accounts_policies,
  (SELECT relrowsecurity FROM pg_class
     WHERE relname = 'major_accounts' AND relnamespace = 'public'::regnamespace)
                                                                    AS major_accounts_rls,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'major_accounts')  AS major_accounts_policies,

  -- Leftovers from the broken early revisions of fix81. Expect 0.
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sub_accounts'
       AND column_name IN ('account_number','label','account_kind','notes','company_id','updated_by'))
                                                                    AS junk_columns;
