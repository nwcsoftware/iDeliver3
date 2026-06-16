-- ============================================================================
-- fix47 — Supplier contact category
-- ----------------------------------------------------------------------------
-- Adds a free-form, user-extensible "Contact Category" to the supplier form.
-- contact_categories holds the selectable list (users add their own from the
-- form); contacts.contact_category stores the chosen value as text. Mirrors
-- business_types (fix46) / order_types (fix42).
-- ============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_category TEXT;

CREATE TABLE IF NOT EXISTS contact_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id),
  name        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_categories_company ON contact_categories(company_id);

-- Grant + permissive policy so the app (anon role) can read/write.
GRANT ALL ON contact_categories TO anon, authenticated;
ALTER TABLE contact_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_contact_categories" ON contact_categories;
CREATE POLICY "dev_anon_contact_categories" ON contact_categories
  FOR ALL TO anon USING (true) WITH CHECK (true);
