-- =============================================================================
-- fix12: Contact addresses (one contact → many addresses)
--
-- A contact (customer / supplier / partner / driver …) can have multiple saved
-- addresses. The user fills in an address name and a reference; the GPS
-- coordinates (latitude / longitude) are filled in later by the application.
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS contact_addresses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES companies(id),

  -- ── User-entered ──────────────────────────────────────────────
  address_name  VARCHAR(150) NOT NULL,        -- e.g. "Home", "Warehouse", "Main Office"
  reference     TEXT,                          -- user-filled landmark / directions reference

  -- ── Filled by the application later ───────────────────────────
  latitude      DECIMAL(10,7),                 -- GPS, set later by the app
  longitude     DECIMAL(10,7),                 -- GPS, set later by the app

  -- ── Proposed helpful extras ───────────────────────────────────
  address_line  TEXT,                          -- full street address (optional)
  city          VARCHAR(100),                  -- city / area (optional)
  phone         VARCHAR(30),                   -- contact phone at this address (optional)
  is_primary    BOOLEAN DEFAULT FALSE,         -- the contact's default address
  is_active     BOOLEAN DEFAULT TRUE,          -- soft hide without deleting
  notes         TEXT,                          -- free notes

  -- ── Audit ─────────────────────────────────────────────────────
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_by    UUID,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup of a contact's addresses.
CREATE INDEX IF NOT EXISTS idx_contact_addresses_contact ON contact_addresses(contact_id);

-- At most one primary address per contact.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_addresses_one_primary
  ON contact_addresses(contact_id) WHERE is_primary;

-- Keep updated_at fresh (reuses the shared trigger function from the main schema).
DROP TRIGGER IF EXISTS trg_contact_addresses_updated_at ON contact_addresses;
CREATE TRIGGER trg_contact_addresses_updated_at
  BEFORE UPDATE ON contact_addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row level security — match the project's dev anon policy used on other tables.
ALTER TABLE contact_addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_contact_addresses" ON contact_addresses;
CREATE POLICY "dev_anon_contact_addresses"
  ON contact_addresses FOR ALL TO anon USING (true) WITH CHECK (true);
