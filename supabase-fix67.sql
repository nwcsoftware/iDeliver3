-- =============================================================================
-- fix67 — Multi-type contacts (a contact can be Customer + Partner + Supplier…)
-- -----------------------------------------------------------------------------
-- Until now each contact had a single `contact_type` (customer / supplier /
-- partner …) and therefore lived on exactly one Contacts page. Businesses often
-- deal with the same party in several roles (a partner who also buys, a supplier
-- who is also a customer), so this adds a `contact_types text[]` "tags" column
-- holding every role a contact has.
--
--   • `contact_type`  stays the PRIMARY type — it still drives the contact code
--     prefix (CST/SUP/PTN…) and account-number prefix, and stays stable.
--   • `contact_types` is the full set of roles; it ALWAYS includes contact_type.
--
-- A BEFORE INSERT/UPDATE trigger keeps the two in sync: if contact_types is
-- empty it is seeded from contact_type, and the primary type is always appended
-- if missing. That way older code paths that only set contact_type still get a
-- correct array automatically.
--
-- Existing rows are backfilled to ARRAY[contact_type]. A GIN index keeps the
-- "contains this role" lookups fast. Safe to run multiple times.
-- =============================================================================

-- 1. Column ------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_types text[];

-- 2. Backfill existing rows from the single primary type ---------------------
UPDATE contacts
   SET contact_types = ARRAY[contact_type]
 WHERE contact_type IS NOT NULL
   AND (contact_types IS NULL OR array_length(contact_types, 1) IS NULL);

-- 3. Keep contact_types in sync with the primary contact_type ----------------
CREATE OR REPLACE FUNCTION sync_contact_types()
RETURNS TRIGGER AS $$
BEGIN
  -- No roles supplied → seed from the primary type.
  IF NEW.contact_types IS NULL OR array_length(NEW.contact_types, 1) IS NULL THEN
    IF NEW.contact_type IS NOT NULL THEN
      NEW.contact_types := ARRAY[NEW.contact_type];
    END IF;
  -- Roles supplied but the primary type isn't among them → add it.
  ELSIF NEW.contact_type IS NOT NULL
        AND NOT (NEW.contact_type = ANY (NEW.contact_types)) THEN
    NEW.contact_types := array_append(NEW.contact_types, NEW.contact_type);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_contact_types ON contacts;
CREATE TRIGGER trg_sync_contact_types
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION sync_contact_types();

-- 4. Fast "contacts that have role X" lookups --------------------------------
CREATE INDEX IF NOT EXISTS idx_contacts_contact_types
  ON contacts USING GIN (contact_types);
