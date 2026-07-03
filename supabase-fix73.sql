-- supabase-fix73.sql
-- Let payment_collections.collected_by hold a DRIVER's contact id.
--
-- The Driver App (Collect) records the collecting driver on each payment:
--   collected_by      = the driver's contacts.id
--   collected_by_name = the driver's name
-- But collected_by originally referenced user_accounts(id) (office collections),
-- and drivers are contacts, so that FK would reject the insert. Drop the FK so the
-- column can hold either a user_accounts id (office collection) or a contacts id
-- (driver collection). Callers distinguish them by matching the order's driver_id.
--
-- Idempotent: drops any foreign-key constraint on collected_by, whatever its name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.payment_collections'::regclass
      AND con.contype  = 'f'
      AND att.attname  = 'collected_by'
  LOOP
    EXECUTE format('ALTER TABLE public.payment_collections DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
