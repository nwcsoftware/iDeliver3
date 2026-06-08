-- =============================================================================
-- fix19: order_external_items
--
-- An exact copy of the order_items table (same columns, types, defaults and
-- foreign keys) named order_external_items, with the identical relationship to
-- delivery_orders (order_id -> delivery_orders.id ON DELETE CASCADE) and the
-- same audit trigger. Use it for items sourced/handled externally, kept
-- separate from the in-house order_items.
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_external_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  item_type       VARCHAR(20) DEFAULT 'product',
  product_id      UUID REFERENCES products(id),
  parcel_description TEXT,
  parcel_weight   DECIMAL(10,2),
  parcel_dimensions VARCHAR(100),
  quantity        DECIMAL(10,2) DEFAULT 1,
  unit_price      DECIMAL(15,2) NOT NULL,
  currency        currency_type DEFAULT 'USD',
  discount        DECIMAL(15,2) DEFAULT 0,
  line_total      DECIMAL(15,2) NOT NULL,
  added_by        UUID REFERENCES user_accounts(id),
  added_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_by      UUID REFERENCES user_accounts(id),
  deleted_at      TIMESTAMPTZ,
  is_deleted      BOOLEAN DEFAULT FALSE
);

-- Same audit trigger as order_items.
DROP TRIGGER IF EXISTS audit_order_external_items ON order_external_items;
CREATE TRIGGER audit_order_external_items
  AFTER INSERT OR UPDATE OR DELETE ON order_external_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
