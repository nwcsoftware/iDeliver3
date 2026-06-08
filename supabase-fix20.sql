-- =============================================================================
-- fix20: retail_goods_invoices
--
-- Records goods invoices from retail shops (supermarket / grocery / bakery /
-- restaurant / sweets / flowers / etc.). Captures the shop name, invoice
-- reference, invoice date (defaults to today) and invoice value with currency,
-- plus a few useful extras (shop type, payment flag, notes). Each invoice
-- belongs to a delivery order via order_id, with the same relation as
-- order_items (NOT NULL + ON DELETE CASCADE).
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retail_goods_invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  -- Same relation to delivery_orders as order_items: required, cascade on delete.
  order_id          UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,

  shop_name         VARCHAR(255) NOT NULL,            -- retail shop name
  shop_type         VARCHAR(30),                      -- supermarket / grocery / bakery / restaurant / sweets / flowers / other
  invoice_reference VARCHAR(100),                     -- shop's invoice reference / number
  invoice_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_value     DECIMAL(15,2) NOT NULL DEFAULT 0, -- total invoice amount
  currency          currency_type DEFAULT 'USD',

  paid              BOOLEAN DEFAULT FALSE,
  notes             TEXT,

  created_by        UUID REFERENCES user_accounts(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID REFERENCES user_accounts(id),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retail_goods_invoices_order ON retail_goods_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_retail_goods_invoices_date  ON retail_goods_invoices(invoice_date);

-- Keep updated_at fresh, and audit every change (same helpers as other tables).
DROP TRIGGER IF EXISTS trg_retail_goods_invoices_updated_at ON retail_goods_invoices;
CREATE TRIGGER trg_retail_goods_invoices_updated_at
  BEFORE UPDATE ON retail_goods_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS audit_retail_goods_invoices ON retail_goods_invoices;
CREATE TRIGGER audit_retail_goods_invoices
  AFTER INSERT OR UPDATE OR DELETE ON retail_goods_invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- Migrate an already-created table to the order_items relation type
-- (order_id NOT NULL + ON DELETE CASCADE). Requires no existing NULL order_id
-- rows. Idempotent: drops/recreates the FK and (re)applies NOT NULL.
ALTER TABLE retail_goods_invoices DROP CONSTRAINT IF EXISTS retail_goods_invoices_order_id_fkey;
ALTER TABLE retail_goods_invoices
  ADD CONSTRAINT retail_goods_invoices_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
ALTER TABLE retail_goods_invoices ALTER COLUMN order_id SET NOT NULL;
