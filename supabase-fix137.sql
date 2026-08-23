-- ============================================================================
-- fix137 — an order records WHO raised it, by name and by id
-- ----------------------------------------------------------------------------
-- `delivery_orders.created_by` existed as a uuid and was never written: every
-- order in the database had it NULL, so no report could say who took an order.
--
-- Two columns rather than one, because they answer different questions:
--
--   created_by     TEXT  the person's NAME as it was at the time — what a
--                        report prints, and what stays readable years later
--                        even if the account is renamed or deleted
--   created_by_id  UUID  the account itself — what a query joins on, and what
--                        survives two people sharing a name
--
-- A name alone rots (accounts get renamed); an id alone is unreadable without
-- a join, and goes blank when the account is deleted. Keeping both means the
-- record still reads properly in either case.
--
-- The type change is safe: every existing value is NULL.
--
-- Safe to run multiple times.
-- ============================================================================

-- ── 1. the name ─────────────────────────────────────────────────────────────
-- `created_by` was a uuid with a foreign key to user_accounts. The key has to
-- go before the type can change — text cannot reference a uuid — and it is not
-- re-created: `created_by_id` below takes over that job, holding the account
-- while `created_by` holds the name. Every other "who did this" column in this
-- schema is a plain uuid without a key, which is why the user-deletion scan
-- (fix134/135) finds them by name rather than by constraint.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.delivery_orders'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.delivery_orders'::regclass AND attname = 'created_by'
      )]::SMALLINT[]
  LOOP
    EXECUTE format('ALTER TABLE public.delivery_orders DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'dropped foreign key %', c.conname;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delivery_orders'
      AND column_name = 'created_by' AND udt_name = 'uuid'
  ) THEN
    ALTER TABLE public.delivery_orders
      ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;
  END IF;
END $$;

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS created_by TEXT;

COMMENT ON COLUMN public.delivery_orders.created_by IS
  'Name of the user who raised the order, as it was at the time';

-- ── 2. the account ──────────────────────────────────────────────────────────
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS created_by_id UUID;

COMMENT ON COLUMN public.delivery_orders.created_by_id IS
  'user_accounts.id of whoever raised the order';

CREATE INDEX IF NOT EXISTS delivery_orders_created_by_id_idx
  ON public.delivery_orders (created_by_id);

-- ── 3. the user-deletion scan must know about the new column ────────────────
-- fix134/fix135 find "who did this" columns by NAME. `created_by_id` is a new
-- spelling, so it is added here — otherwise deleting a user would leave their
-- id stamped on every order they raised.
CREATE OR REPLACE FUNCTION public._user_ref_columns()
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
      'created_by', 'created_by_id', 'updated_by', 'deleted_by', 'added_by', 'removed_by',
      'confirmed_by', 'approved_by', 'rejected_by', 'requested_by',
      'responded_by', 'cancellation_requested_by', 'deactivated_by',
      'collected_by', 'paid_by', 'closed_by', 'opened_by', 'reset_by',
      'assigned_by', 'returned_by', 'sent_by', 'uploaded_by', 'acted_by'
    )
    AND NOT (c.table_name = 'user_accounts' AND c.column_name = 'id');
$$;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'delivery_orders'
  AND column_name IN ('created_by', 'created_by_id')
ORDER BY column_name;

NOTIFY pgrst, 'reload schema';
