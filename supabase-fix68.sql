-- =============================================================================
-- fix68 — Fix sync_contact_types trigger (enum vs text[] type mismatch)
-- -----------------------------------------------------------------------------
-- `contacts.contact_type` is the enum type `contact_type`, but `contact_types`
-- is `text[]`. The fix67 trigger compared them directly:
--     NEW.contact_type = ANY (NEW.contact_types)
-- Postgres has no `enum = text` operator, so this raised
--     operator does not exist: contact_type = text
-- on EVERY insert/update whose contact_types array was non-empty — which, after
-- the fix67 backfill, is every existing contact. The practical effect: NO contact
-- row could be updated at all (editing, re-tagging, toggling active all failed),
-- and multi-role tags (e.g. Partner + Supplier) could never be saved.
--
-- This recreates the function casting the enum to text on both comparisons, so
-- the role array is plain text on both sides. Behaviour is otherwise identical to
-- fix67. Trigger definition is unchanged. Safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_contact_types()
RETURNS TRIGGER AS $$
BEGIN
  -- No roles supplied → seed from the primary type.
  IF NEW.contact_types IS NULL OR array_length(NEW.contact_types, 1) IS NULL THEN
    IF NEW.contact_type IS NOT NULL THEN
      NEW.contact_types := ARRAY[NEW.contact_type::text];
    END IF;
  -- Roles supplied but the primary type isn't among them → add it.
  ELSIF NEW.contact_type IS NOT NULL
        AND NOT (NEW.contact_type::text = ANY (NEW.contact_types)) THEN
    NEW.contact_types := array_append(NEW.contact_types, NEW.contact_type::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
