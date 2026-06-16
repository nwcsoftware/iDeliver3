-- =============================================================================
-- fix14: Delivery packages
--
-- A delivery order (especially a partner's order) can carry one or more
-- physical packages. Each package describes what is being shipped and how it
-- must be handled / which vehicle it needs.
--
-- Relation: delivery_packages.order_id → delivery_orders(id) (many per order).
-- contact_code is copied from the order's contact for quick reference.
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS delivery_packages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES companies(id),
  contact_code    VARCHAR(30),                  -- inherited from the order's contact

  -- Identification
  tracking_number VARCHAR(50),                  -- per-package tracking reference

  -- Classification
  category        VARCHAR(40),                  -- nature: food, grocery, supermarket_retail, electronics, documents, clothing, other
  type            VARCHAR(40),                  -- form factor: parcel, box, envelope, pallet, bag, crate
  package_size    VARCHAR(20),                  -- small, medium, large, extra_large
  handling        VARCHAR(20) DEFAULT 'regular',-- regular, fragile
  vehicle_type    VARCHAR(20),                  -- motorcycle, car, van, cargo

  -- Measurements / contents
  quantity        INTEGER DEFAULT 1,
  weight_kg       DECIMAL(10,2),
  description     TEXT,
  notes           TEXT,

  -- Status (independent of the order's overall status)
  status          VARCHAR(20) DEFAULT 'pending',

  -- Audit
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_by      UUID,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup of an order's packages.
CREATE INDEX IF NOT EXISTS idx_delivery_packages_order ON delivery_packages(order_id);
-- Lookups by tracking number.
CREATE INDEX IF NOT EXISTS idx_delivery_packages_tracking ON delivery_packages(tracking_number)
  WHERE tracking_number IS NOT NULL;

-- Keep updated_at fresh (reuses the shared trigger function).
DROP TRIGGER IF EXISTS trg_delivery_packages_updated_at ON delivery_packages;
CREATE TRIGGER trg_delivery_packages_updated_at
  BEFORE UPDATE ON delivery_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row level security — match the project's dev anon policy.
ALTER TABLE delivery_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_delivery_packages" ON delivery_packages;
CREATE POLICY "dev_anon_delivery_packages"
  ON delivery_packages FOR ALL TO anon USING (true) WITH CHECK (true);
