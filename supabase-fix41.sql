-- ============================================================================
-- fix41 — Returnable items (e.g. shisha, gas cylinders) tracking
-- ----------------------------------------------------------------------------
-- Adds an is_returnable flag to products and a table that tracks each time a
-- returnable item goes out to a customer and (later) comes back. The app uses
-- it to show how many are out, for how many days, and what's left in store.
-- ============================================================================

-- Flag returnable products.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN DEFAULT FALSE;

-- One row per issuance of a returnable item; returned_date IS NULL means it's
-- still out with the customer.
CREATE TABLE IF NOT EXISTS returnable_issuances (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID REFERENCES companies(id),
  product_id    UUID NOT NULL REFERENCES products(id),
  customer_id   UUID REFERENCES contacts(id),
  order_id      UUID REFERENCES delivery_orders(id),
  reference     TEXT,                         -- free text: customer / order / note
  quantity      DECIMAL(15,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  issued_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  returned_date DATE,                         -- NULL = still out
  returned_qty  DECIMAL(15,2),
  notes         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_returnable_issuances_product ON returnable_issuances(product_id);
CREATE INDEX IF NOT EXISTS idx_returnable_issuances_open    ON returnable_issuances(product_id) WHERE returned_date IS NULL;

-- Grant + permissive policy so the app (anon role) can read/write.
GRANT ALL ON returnable_issuances TO anon, authenticated;
ALTER TABLE returnable_issuances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_returnable_issuances" ON returnable_issuances;
CREATE POLICY "dev_anon_returnable_issuances" ON returnable_issuances
  FOR ALL TO anon USING (true) WITH CHECK (true);
