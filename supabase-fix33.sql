-- ============================================================================
-- fix33 — Widen account-number columns from 12 to 16 digits
-- ----------------------------------------------------------------------------
-- Account numbers are now random 16-digit values (see fix32 and
-- src/lib/accountNumber.js). This migration widens every column that stores an
-- account number so the longer values fit.
--
-- RELATIONS ARE SAFE: every table-to-table relation in this schema is a UUID
-- foreign key on `id` (REFERENCES contacts(id), REFERENCES vehicles(id), …).
-- No foreign key references account_number / vehicle_account_number, so changing
-- the type of these text columns does NOT touch any relationship. The
-- delivery_orders.main_account column is only a denormalised snapshot of the
-- customer's account_number (copied at order time), not a foreign key.
--
-- Columns widened:
--   contacts.account_number
--   vehicles.vehicle_account_number
--   delivery_orders.main_account   (snapshot of the customer account number)
--
-- The change is defensive and idempotent:
--   * Only runs for columns that actually exist.
--   * Strips any stray non-digit characters while converting (USING clause).
--   * VARCHAR(16) still accepts the old ≤12-digit values.
-- ============================================================================

DO $$
DECLARE
  -- table_name, column_name pairs to widen.
  v_targets TEXT[][] := ARRAY[
    ['contacts',        'account_number'],
    ['vehicles',        'vehicle_account_number'],
    ['delivery_orders', 'main_account']
  ];
  v_tbl TEXT;
  v_col TEXT;
  i     INT;
BEGIN
  FOR i IN 1 .. array_length(v_targets, 1) LOOP
    v_tbl := v_targets[i][1];
    v_col := v_targets[i][2];

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name  = v_tbl
        AND column_name = v_col
    ) THEN
      -- Cast to text first so numeric columns (e.g. vehicle_account_number) convert
      -- too. regexp_replace(NULL, …) returns NULL, so empty values stay NULL.
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE VARCHAR(16) '
        'USING regexp_replace(%I::text, %L, %L, %L)',
        v_tbl, v_col, v_col, '\D', '', 'g'
      );
      RAISE NOTICE 'Widened %.% to VARCHAR(16)', v_tbl, v_col;
    ELSE
      RAISE NOTICE 'Skipped %.% (column not found)', v_tbl, v_col;
    END IF;
  END LOOP;
END $$;
