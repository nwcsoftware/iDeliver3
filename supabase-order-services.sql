-- =============================================================================
-- ORDER SERVICES TABLE
-- Stores additional services for delivery orders
-- =============================================================================

-- Create order_services table
CREATE TABLE order_services (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id              UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  service_date          DATE NOT NULL,
  service_description   TEXT,
  service_reference     VARCHAR(100),
  quantity              INTEGER DEFAULT 1 CHECK (quantity > 0),
  service_fees          DECIMAL(15,2) NOT NULL,
  service_fees_currency currency_type DEFAULT 'USD',
  -- Audit
  created_by            UUID REFERENCES user_accounts(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_by            UUID REFERENCES user_accounts(id),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, order_id, service_reference)
);

-- Create index for faster queries
CREATE INDEX idx_order_services_order_id ON order_services(order_id);
CREATE INDEX idx_order_services_company_id ON order_services(company_id);
CREATE INDEX idx_order_services_service_date ON order_services(service_date);

-- Add comments for clarity
COMMENT ON TABLE order_services IS 'Additional services associated with delivery orders (e.g., special handling, insurance, etc.)';
COMMENT ON COLUMN order_services.quantity IS 'Number of times the service is applied (default: 1)';
COMMENT ON COLUMN order_services.service_fees_currency IS 'Currency for the service fees (USD, LBP, EUR)';
