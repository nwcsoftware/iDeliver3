-- =============================================================================
-- fix66 — Unique contact code generation (no more duplicate "contacts_code_key")
-- -----------------------------------------------------------------------------
-- The BEFORE INSERT trigger generate_contact_code() built the code as
--   <PREFIX>-<COUNT(*) + 1>   per contact_type.
-- Using COUNT is collision-prone: after ANY contact of that type is deleted, the
-- count drops and the next insert regenerates a code that already exists, raising
--   duplicate key value violates unique constraint "contacts_code_key".
--
-- This recreates the function to:
--   1. take the highest existing numeric suffix for the prefix (gap-safe), +1, and
--   2. loop until the candidate is actually unused — so it can never collide,
--      even with legacy/manually-entered codes.
--
-- Trigger definition is unchanged (still BEFORE INSERT … WHEN NEW.code IS NULL).
-- Safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_contact_code()
RETURNS TRIGGER AS $$
DECLARE
  prefix    TEXT;
  seq_val   INTEGER;
  candidate TEXT;
BEGIN
  prefix := CASE NEW.contact_type
    WHEN 'customer'   THEN 'CST'
    WHEN 'employee'   THEN 'EMP'
    WHEN 'driver'     THEN 'DRV'
    WHEN 'supplier'   THEN 'SUP'
    WHEN 'partner'    THEN 'PTN'
    WHEN 'contractor' THEN 'CON'
    ELSE 'OTH'
  END;

  -- Highest numeric suffix already used for this prefix (NULL-safe → 0), + 1.
  SELECT COALESCE(MAX((substring(code from '[0-9]+$'))::int), 0) + 1
    INTO seq_val
    FROM contacts
    WHERE code LIKE prefix || '-%';

  candidate := prefix || '-' || LPAD(seq_val::TEXT, 6, '0');

  -- Guarantee uniqueness against any unexpected existing value.
  WHILE EXISTS (SELECT 1 FROM contacts WHERE code = candidate) LOOP
    seq_val   := seq_val + 1;
    candidate := prefix || '-' || LPAD(seq_val::TEXT, 6, '0');
  END LOOP;

  NEW.code := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
