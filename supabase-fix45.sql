-- ============================================================================
-- fix45 — Service provider on order services
-- ----------------------------------------------------------------------------
-- The order form's "Order Services" sub-form can now record which supplier
-- provided each service ("Service provider"). It references a supplier contact.
-- order_services already has a permissive policy, so no policy change is needed.
-- ============================================================================

ALTER TABLE order_services
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES contacts(id);

CREATE INDEX IF NOT EXISTS idx_order_services_provider ON order_services(provider_id);
