-- ============================================================================
-- fix42 — Custom order types
-- ----------------------------------------------------------------------------
-- The order form's "Order Type" was a fixed list (restaurant, supermarket, …).
-- This table lets admins add their own order types from the order form. The
-- built-in types still appear as defaults; delivery_orders.order_type continues
-- to store the type as text.
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id),
  name        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_types_company ON order_types(company_id);

-- Grant + permissive policy so the app (anon role) can read/write.
GRANT ALL ON order_types TO anon, authenticated;
ALTER TABLE order_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_order_types" ON order_types;
CREATE POLICY "dev_anon_order_types" ON order_types
  FOR ALL TO anon USING (true) WITH CHECK (true);
