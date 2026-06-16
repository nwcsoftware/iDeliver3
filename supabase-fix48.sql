-- ============================================================================
-- fix48 — Package provider on delivery packages
-- ----------------------------------------------------------------------------
-- The order form's "Delivery Packages" sub-form can now record which provider
-- handled each package ("Package provider"). The dropdown is fed from contacts
-- whose contact_category = 'Online'. This column stores the chosen contact.
-- delivery_packages already has a permissive policy, so no policy change needed.
-- ============================================================================

ALTER TABLE delivery_packages
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES contacts(id);

CREATE INDEX IF NOT EXISTS idx_delivery_packages_provider ON delivery_packages(provider_id);
