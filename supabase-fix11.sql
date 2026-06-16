-- =============================================================================
-- fix11: Individual vs Company contacts
--
-- Customers, suppliers and partners can now be either an Individual (default)
-- or a Company. Company contacts additionally carry a (mandatory) company name
-- and an (optional) commercial registration number.
--
-- first_name / last_name remain NOT NULL — for a company they hold the
-- contact person's first / last name ("Contact First/Last Name" in the UI).
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) NOT NULL DEFAULT 'individual';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS commercial_registration VARCHAR(100);

-- Only allow the two known entity types.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_entity_type_chk'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_entity_type_chk
      CHECK (entity_type IN ('individual', 'company'));
  END IF;
END $$;
