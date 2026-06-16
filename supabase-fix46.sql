-- ============================================================================
-- fix46 — Custom supplier business types
-- ----------------------------------------------------------------------------
-- The supplier form's "Business Type" was a fixed list (supermarket, grocery,
-- bakery, …). This table lets users add their own business types from the
-- supplier form. The built-in types still appear as defaults; contacts.shop_type
-- continues to store the type as text. Mirrors order_types (fix42).
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id),
  name        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_types_company ON business_types(company_id);

-- Grant + permissive policy so the app (anon role) can read/write.
GRANT ALL ON business_types TO anon, authenticated;
ALTER TABLE business_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_business_types" ON business_types;
CREATE POLICY "dev_anon_business_types" ON business_types
  FOR ALL TO anon USING (true) WITH CHECK (true);
