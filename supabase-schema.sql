-- =============================================================================
-- DELIVERY SOFTWARE - FULL SUPABASE DATABASE SCHEMA
-- =============================================================================
-- Modules Covered:
--   A. Administration
--   B. Call Center
--   C. Drivers
--   D. Customers
--   E. Suppliers
--   F. Partners
--   + Inventory, Fleet, Payroll, Expenses, Accounting, OTP, Audit Logs
-- =============================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- SECTION 1: ENUMERATIONS (TYPES)
-- =============================================================================

CREATE TYPE user_role AS ENUM (
  'super_admin', 'admin', 'call_center', 'driver',
  'customer', 'supplier', 'partner'
);

CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending');

CREATE TYPE contact_type AS ENUM (
  'customer', 'employee', 'driver', 'supplier',
  'partner', 'contractor', 'other'
);

CREATE TYPE account_type AS ENUM ('cash', 'credit', 'debit', 'bank', 'petty_cash');

CREATE TYPE currency_type AS ENUM ('USD', 'LBP', 'EUR');

CREATE TYPE order_status AS ENUM (
  'pending', 'confirmed', 'assigned', 'picked_up',
  'in_transit', 'delivered', 'cancelled', 'failed',
  'return_requested', 'returned'
);

CREATE TYPE payment_status AS ENUM (
  'unpaid', 'partially_paid', 'due_for_collection',
  'collected_by_driver', 'paid_to_office', 'closed', 'refunded'
);

CREATE TYPE driver_status AS ENUM ('available', 'on_duty', 'off_duty', 'inactive');

CREATE TYPE otp_purpose AS ENUM (
  'customer_payment', 'driver_payment_to_office',
  'supplier_invoice_confirm', 'customer_registration',
  'partner_registration', 'user_login'
);

CREATE TYPE otp_status AS ENUM ('pending', 'verified', 'expired', 'failed');

CREATE TYPE invoice_type AS ENUM ('sales', 'purchase', 'credit_note', 'debit_note');

CREATE TYPE vehicle_status AS ENUM ('active', 'in_maintenance', 'retired', 'sold');

CREATE TYPE salary_type AS ENUM ('monthly', 'weekly', 'daily', 'per_delivery', 'contract');

CREATE TYPE expense_category AS ENUM (
  'electricity', 'water', 'rent', 'internet', 'fuel',
  'cleaning', 'food_beverages', 'maintenance', 'insurance',
  'salary', 'petty_cash', 'other'
);

CREATE TYPE inventory_transaction_type AS ENUM (
  'purchase', 'sale', 'adjustment', 'return', 'transfer', 'damage'
);

CREATE TYPE parcel_status AS ENUM ('pending', 'in_warehouse', 'in_transit', 'delivered', 'returned');

-- =============================================================================
-- SECTION 2: COMPANY & BRANCHES
-- =============================================================================

CREATE TABLE companies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code              VARCHAR(20) UNIQUE NOT NULL,
  name              VARCHAR(255) NOT NULL,
  name_ar           VARCHAR(255),
  cr_number         VARCHAR(100),
  vat_number        VARCHAR(100),
  tax_id            VARCHAR(100),
  address           TEXT,
  city              VARCHAR(100),
  country           VARCHAR(100) DEFAULT 'Lebanon',
  phone             VARCHAR(30),
  email             VARCHAR(255),
  website           VARCHAR(255),
  logo_url          TEXT,
  currency_default  currency_type DEFAULT 'USD',
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  name_ar     VARCHAR(255),
  address     TEXT,
  city        VARCHAR(100),
  phone       VARCHAR(30),
  email       VARCHAR(255),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, code)
);

-- =============================================================================
-- SECTION 3: CONTACTS (Customers, Employees, Drivers, Suppliers, Partners)
-- =============================================================================

CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  contact_type      contact_type NOT NULL,
  code              VARCHAR(30) UNIQUE,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  full_name_ar      VARCHAR(255),
  mobile            VARCHAR(30) UNIQUE NOT NULL,
  mobile_verified   BOOLEAN DEFAULT FALSE,
  whatsapp_number   VARCHAR(30),
  email             VARCHAR(255),
  email_verified    BOOLEAN DEFAULT FALSE,
  id_number         VARCHAR(50),
  address           TEXT,
  city              VARCHAR(100),
  latitude          DECIMAL(10,7),
  longitude         DECIMAL(10,7),
  notes             TEXT,
  is_active         BOOLEAN DEFAULT TRUE,
  -- Driver-specific
  driver_status     driver_status,
  driver_license    VARCHAR(50),
  vehicle_id        UUID,
  petty_cash_limit  DECIMAL(15,2) DEFAULT 0,
  petty_cash_currency currency_type DEFAULT 'USD',
  -- Partner-specific
  partner_confirmed BOOLEAN DEFAULT FALSE,
  partner_percentage DECIMAL(5,2),
  -- Employee-specific
  hire_date         DATE,
  salary_type       salary_type,
  base_salary       DECIMAL(15,2),
  salary_currency   currency_type DEFAULT 'USD',
  department        VARCHAR(100),
  job_title         VARCHAR(100),
  -- Supplier-specific
  supplier_code     VARCHAR(50),
  payment_terms     INTEGER,
  -- Audit
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 4: USER ACCOUNTS & AUTHENTICATION
-- =============================================================================

CREATE TABLE user_accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id        UUID UNIQUE REFERENCES contacts(id),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  username          VARCHAR(100) UNIQUE NOT NULL,
  email             VARCHAR(255) UNIQUE,
  mobile            VARCHAR(30) NOT NULL,
  password_hash     TEXT NOT NULL,
  role              user_role NOT NULL,
  status            user_status DEFAULT 'pending',
  permissions       JSONB DEFAULT '{}',
  last_login_at     TIMESTAMPTZ,
  last_login_ip     INET,
  failed_attempts   INTEGER DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  must_change_password BOOLEAN DEFAULT FALSE,
  two_fa_enabled    BOOLEAN DEFAULT FALSE,
  two_fa_secret     TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deactivated_by    UUID,
  deactivated_at    TIMESTAMPTZ
);

CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  session_token   TEXT UNIQUE NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  device_info     JSONB,
  logged_in_at    TIMESTAMPTZ DEFAULT NOW(),
  logged_out_at   TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  expires_at      TIMESTAMPTZ
);

CREATE TABLE user_logbook (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES user_accounts(id),
  action      VARCHAR(100) NOT NULL,
  description TEXT,
  ip_address  INET,
  device_info JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 5: ACCOUNT NUMBERS (Chart of Accounts)
-- =============================================================================

CREATE TABLE major_accounts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  code          VARCHAR(20) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  account_type  account_type NOT NULL,
  description   TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE sub_accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  major_account_id  UUID NOT NULL REFERENCES major_accounts(id),
  contact_id        UUID REFERENCES contacts(id),
  code              VARCHAR(30) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  account_type      account_type NOT NULL,
  currency          currency_type DEFAULT 'USD',
  current_balance   DECIMAL(15,2) DEFAULT 0,
  credit_limit      DECIMAL(15,2),
  description       TEXT,
  is_active         BOOLEAN DEFAULT TRUE,
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (major_account_id, code)
);

CREATE TABLE journal_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  entry_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_type    VARCHAR(50),
  reference_id      UUID,
  sub_account_id    UUID REFERENCES sub_accounts(id),
  debit_amount      DECIMAL(15,2) DEFAULT 0,
  credit_amount     DECIMAL(15,2) DEFAULT 0,
  currency          currency_type DEFAULT 'USD',
  exchange_rate     DECIMAL(15,6) DEFAULT 1,
  description       TEXT,
  created_by        UUID REFERENCES user_accounts(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 6: OTP MANAGEMENT
-- =============================================================================

CREATE TABLE otp_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purpose         otp_purpose NOT NULL,
  recipient_type  VARCHAR(30),
  recipient_id    UUID,
  mobile          VARCHAR(30) NOT NULL,
  whatsapp_number VARCHAR(30),
  otp_code        VARCHAR(10) NOT NULL,
  otp_hash        TEXT,
  reference_id    UUID,
  reference_type  VARCHAR(50),
  status          otp_status DEFAULT 'pending',
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 3,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  verified_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 7: INVENTORY & PRODUCTS
-- =============================================================================

CREATE TABLE product_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  parent_id   UUID REFERENCES product_categories(id),
  code        VARCHAR(30),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  category_id         UUID REFERENCES product_categories(id),
  code                VARCHAR(50) UNIQUE NOT NULL,
  barcode             VARCHAR(100),
  name                VARCHAR(255) NOT NULL,
  description         TEXT,
  unit_of_measure     VARCHAR(30) DEFAULT 'pcs',
  unit_cost           DECIMAL(15,2) DEFAULT 0,
  unit_price          DECIMAL(15,2) DEFAULT 0,
  currency            currency_type DEFAULT 'USD',
  reorder_level       DECIMAL(15,2) DEFAULT 0,
  reorder_quantity    DECIMAL(15,2) DEFAULT 0,
  image_url           TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  is_deliverable      BOOLEAN DEFAULT TRUE,
  is_retail           BOOLEAN DEFAULT TRUE,
  created_by          UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id          UUID NOT NULL REFERENCES products(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  quantity_on_hand    DECIMAL(15,2) DEFAULT 0,
  quantity_reserved   DECIMAL(15,2) DEFAULT 0,
  quantity_available  DECIMAL(15,2) GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
  last_updated        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID NOT NULL REFERENCES products(id),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  transaction_type inventory_transaction_type NOT NULL,
  quantity        DECIMAL(15,2) NOT NULL,
  unit_cost       DECIMAL(15,2),
  reference_type  VARCHAR(50),
  reference_id    UUID,
  notes           TEXT,
  created_by      UUID REFERENCES user_accounts(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 8: SUPPLIERS & PURCHASE INVOICES
-- =============================================================================

CREATE TABLE purchase_invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  supplier_id       UUID NOT NULL REFERENCES contacts(id),
  invoice_number    VARCHAR(100) NOT NULL,
  invoice_date      DATE NOT NULL,
  due_date          DATE,
  currency          currency_type DEFAULT 'USD',
  subtotal          DECIMAL(15,2) DEFAULT 0,
  vat_amount        DECIMAL(15,2) DEFAULT 0,
  discount_amount   DECIMAL(15,2) DEFAULT 0,
  total_amount      DECIMAL(15,2) DEFAULT 0,
  paid_amount       DECIMAL(15,2) DEFAULT 0,
  balance_due       DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  otp_confirmed     BOOLEAN DEFAULT FALSE,
  otp_id            UUID REFERENCES otp_logs(id),
  confirmed_by      UUID REFERENCES user_accounts(id),
  confirmed_at      TIMESTAMPTZ,
  status            VARCHAR(30) DEFAULT 'pending',
  notes             TEXT,
  created_by        UUID REFERENCES user_accounts(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_invoice_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id),
  quantity            DECIMAL(15,2) NOT NULL,
  unit_cost           DECIMAL(15,2) NOT NULL,
  vat_rate            DECIMAL(5,2) DEFAULT 0,
  discount_rate       DECIMAL(5,2) DEFAULT 0,
  line_total          DECIMAL(15,2) NOT NULL,
  received_quantity   DECIMAL(15,2) DEFAULT 0,
  reception_confirmed BOOLEAN DEFAULT FALSE,
  reception_date      TIMESTAMPTZ,
  notes               TEXT
);

-- =============================================================================
-- SECTION 9: DELIVERY ORDERS
-- =============================================================================

CREATE TABLE delivery_zones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  base_fee    DECIMAL(15,2) DEFAULT 0,
  currency    currency_type DEFAULT 'USD',
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE delivery_orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  branch_id           UUID REFERENCES branches(id),
  order_number        VARCHAR(50) UNIQUE NOT NULL,
  -- Parties
  customer_id         UUID NOT NULL REFERENCES contacts(id),
  partner_id          UUID REFERENCES contacts(id),
  driver_id           UUID REFERENCES contacts(id),
  assigned_by         UUID REFERENCES user_accounts(id),
  assigned_at         TIMESTAMPTZ,
  -- Pickup & Delivery
  pickup_address      TEXT,
  pickup_lat          DECIMAL(10,7),
  pickup_lng          DECIMAL(10,7),
  pickup_branch_id    UUID REFERENCES branches(id),
  delivery_address    TEXT NOT NULL,
  delivery_lat        DECIMAL(10,7),
  delivery_lng        DECIMAL(10,7),
  delivery_zone_id    UUID REFERENCES delivery_zones(id),
  scheduled_date      DATE,
  scheduled_time_from TIME,
  scheduled_time_to   TIME,
  order_details_text  TEXT,
  special_instructions TEXT,
  recipient_name      VARCHAR(255),
  recipient_mobile    VARCHAR(30) NOT NULL,
  recipient_whatsapp  VARCHAR(30),
  -- Status
  status              order_status DEFAULT 'pending',
  payment_status      payment_status DEFAULT 'unpaid',
  cancellation_reason TEXT,
  cancellation_requested_by UUID REFERENCES user_accounts(id),
  cancellation_requested_at TIMESTAMPTZ,
  -- Pricing
  delivery_fee        DECIMAL(15,2) DEFAULT 0,
  currency            currency_type DEFAULT 'USD',
  items_total         DECIMAL(15,2) DEFAULT 0,
  discount_amount     DECIMAL(15,2) DEFAULT 0,
  vat_amount          DECIMAL(15,2) DEFAULT 0,
  total_amount        DECIMAL(15,2) DEFAULT 0,
  collected_usd       DECIMAL(15,2) DEFAULT 0,
  collected_lbp       DECIMAL(15,2) DEFAULT 0,
  -- Partner pricing
  partner_customer_price DECIMAL(15,2),
  partner_invoice_price  DECIMAL(15,2),
  partner_commission     DECIMAL(15,2),
  -- OTP
  customer_otp_id     UUID REFERENCES otp_logs(id),
  customer_otp_verified BOOLEAN DEFAULT FALSE,
  customer_otp_verified_at TIMESTAMPTZ,
  -- Receipt
  receipt_pdf_url     TEXT,
  receipt_sent_at     TIMESTAMPTZ,
  -- Audit
  created_by          UUID REFERENCES user_accounts(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_by          UUID REFERENCES user_accounts(id),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  confirmed_by        UUID REFERENCES user_accounts(id),
  confirmed_at        TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  closed_by           UUID REFERENCES user_accounts(id),
  closed_at           TIMESTAMPTZ
);

CREATE TABLE order_items (
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

-- =============================================================================
-- SECTION 10: ORDER PAYMENT COLLECTIONS
-- =============================================================================

CREATE TABLE payment_collections (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID NOT NULL REFERENCES delivery_orders(id),
  collection_type     VARCHAR(30) NOT NULL,
  amount_usd          DECIMAL(15,2) DEFAULT 0,
  amount_lbp          DECIMAL(15,2) DEFAULT 0,
  exchange_rate       DECIMAL(15,6) DEFAULT 1,
  otp_id              UUID REFERENCES otp_logs(id),
  otp_verified        BOOLEAN DEFAULT FALSE,
  otp_verified_at     TIMESTAMPTZ,
  collected_by        UUID REFERENCES user_accounts(id),
  collected_at        TIMESTAMPTZ DEFAULT NOW(),
  receipt_pdf_url     TEXT,
  receipt_sent_at     TIMESTAMPTZ,
  receipt_email       VARCHAR(255),
  created_by          UUID REFERENCES user_accounts(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  notes               TEXT
);

CREATE TABLE driver_daily_settlements (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id           UUID NOT NULL REFERENCES contacts(id),
  settlement_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  total_orders        INTEGER DEFAULT 0,
  total_collected_usd DECIMAL(15,2) DEFAULT 0,
  total_collected_lbp DECIMAL(15,2) DEFAULT 0,
  amount_paid_usd     DECIMAL(15,2) DEFAULT 0,
  amount_paid_lbp     DECIMAL(15,2) DEFAULT 0,
  difference_usd      DECIMAL(15,2) DEFAULT 0,
  difference_lbp      DECIMAL(15,2) DEFAULT 0,
  otp_id              UUID REFERENCES otp_logs(id),
  otp_verified        BOOLEAN DEFAULT FALSE,
  otp_verified_at     TIMESTAMPTZ,
  receipt_pdf_url     TEXT,
  received_by         UUID REFERENCES user_accounts(id),
  received_at         TIMESTAMPTZ,
  status              VARCHAR(20) DEFAULT 'pending',
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 11: DRIVER PETTY CASH
-- =============================================================================

CREATE TABLE driver_petty_cash (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id       UUID NOT NULL REFERENCES contacts(id),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount          DECIMAL(15,2) NOT NULL,
  currency        currency_type DEFAULT 'USD',
  transaction_type VARCHAR(20) NOT NULL,
  purpose         TEXT,
  balance_after   DECIMAL(15,2),
  approved_by     UUID REFERENCES user_accounts(id),
  approved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_by      UUID REFERENCES user_accounts(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 12: ORDER TRACKING & HISTORY
-- =============================================================================

CREATE TABLE order_tracking (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  status          order_status NOT NULL,
  notes           TEXT,
  latitude        DECIMAL(10,7),
  longitude       DECIMAL(10,7),
  updated_by      UUID REFERENCES user_accounts(id),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE driver_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id   UUID NOT NULL REFERENCES contacts(id),
  latitude    DECIMAL(10,7) NOT NULL,
  longitude   DECIMAL(10,7) NOT NULL,
  accuracy    DECIMAL(8,2),
  speed       DECIMAL(8,2),
  heading     DECIMAL(6,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 13: SALES INVOICES
-- =============================================================================

CREATE TABLE sales_invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  branch_id       UUID REFERENCES branches(id),
  customer_id     UUID NOT NULL REFERENCES contacts(id),
  invoice_number  VARCHAR(100) UNIQUE NOT NULL,
  invoice_type    invoice_type DEFAULT 'sales',
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  currency        currency_type DEFAULT 'USD',
  subtotal        DECIMAL(15,2) DEFAULT 0,
  vat_amount      DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  total_amount    DECIMAL(15,2) DEFAULT 0,
  paid_amount     DECIMAL(15,2) DEFAULT 0,
  balance_due     DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  status          VARCHAR(30) DEFAULT 'draft',
  notes           TEXT,
  pdf_url         TEXT,
  sent_at         TIMESTAMPTZ,
  created_by      UUID REFERENCES user_accounts(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_by      UUID,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales_invoice_orders (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  order_id    UUID NOT NULL REFERENCES delivery_orders(id),
  amount      DECIMAL(15,2) NOT NULL
);

-- =============================================================================
-- SECTION 14: POINT OF SALE
-- =============================================================================

CREATE TABLE pos_transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID NOT NULL REFERENCES branches(id),
  transaction_number VARCHAR(50) UNIQUE NOT NULL,
  customer_id       UUID REFERENCES contacts(id),
  cashier_id        UUID NOT NULL REFERENCES user_accounts(id),
  transaction_date  TIMESTAMPTZ DEFAULT NOW(),
  subtotal          DECIMAL(15,2) DEFAULT 0,
  vat_amount        DECIMAL(15,2) DEFAULT 0,
  discount_amount   DECIMAL(15,2) DEFAULT 0,
  total_amount      DECIMAL(15,2) DEFAULT 0,
  paid_amount       DECIMAL(15,2) DEFAULT 0,
  change_amount     DECIMAL(15,2) DEFAULT 0,
  payment_method    VARCHAR(30),
  currency          currency_type DEFAULT 'USD',
  status            VARCHAR(20) DEFAULT 'completed',
  notes             TEXT,
  receipt_pdf_url   TEXT
);

CREATE TABLE pos_transaction_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id  UUID NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  quantity        DECIMAL(10,2) NOT NULL,
  unit_price      DECIMAL(15,2) NOT NULL,
  discount        DECIMAL(15,2) DEFAULT 0,
  line_total      DECIMAL(15,2) NOT NULL
);

-- =============================================================================
-- SECTION 15: FLEET VEHICLES & EQUIPMENT
-- =============================================================================

CREATE TABLE vehicles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  branch_id           UUID REFERENCES branches(id),
  asset_code          VARCHAR(50) UNIQUE NOT NULL,
  type                VARCHAR(50),
  make                VARCHAR(100),
  model               VARCHAR(100),
  year                INTEGER,
  plate_number        VARCHAR(50) UNIQUE,
  vin                 VARCHAR(100),
  color               VARCHAR(50),
  status              vehicle_status DEFAULT 'active',
  purchase_date       DATE,
  purchase_value      DECIMAL(15,2),
  purchase_currency   currency_type DEFAULT 'USD',
  current_value       DECIMAL(15,2),
  depreciation_rate   DECIMAL(5,2),
  insurance_company   VARCHAR(255),
  insurance_policy    VARCHAR(100),
  insurance_expiry    DATE,
  insurance_value     DECIMAL(15,2),
  current_mileage     DECIMAL(12,2) DEFAULT 0,
  notes               TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_by          UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contacts ADD CONSTRAINT fk_driver_vehicle
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE TABLE vehicle_insurance (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  policy_number   VARCHAR(100) NOT NULL,
  insurer         VARCHAR(255) NOT NULL,
  coverage_type   VARCHAR(100),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  premium_amount  DECIMAL(15,2),
  currency        currency_type DEFAULT 'USD',
  document_url    TEXT,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_maintenance (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id          UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_type    VARCHAR(50),
  description         TEXT NOT NULL,
  maintenance_date    DATE NOT NULL,
  mileage_at_service  DECIMAL(12,2),
  next_service_mileage DECIMAL(12,2),
  next_service_date   DATE,
  cost                DECIMAL(15,2),
  currency            currency_type DEFAULT 'USD',
  workshop            VARCHAR(255),
  invoice_number      VARCHAR(100),
  document_url        TEXT,
  performed_by        UUID REFERENCES user_accounts(id),
  notes               TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_fuel_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
  driver_id       UUID REFERENCES contacts(id),
  fuel_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  liters          DECIMAL(10,2) NOT NULL,
  price_per_liter DECIMAL(10,3),
  total_cost      DECIMAL(15,2),
  currency        currency_type DEFAULT 'USD',
  odometer        DECIMAL(12,2),
  fuel_station    VARCHAR(255),
  notes           TEXT,
  created_by      UUID REFERENCES user_accounts(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_mileage_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id),
  driver_id   UUID REFERENCES contacts(id),
  log_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  start_km    DECIMAL(12,2) NOT NULL,
  end_km      DECIMAL(12,2),
  distance    DECIMAL(12,2) GENERATED ALWAYS AS (COALESCE(end_km, start_km) - start_km) STORED,
  purpose     TEXT,
  order_id    UUID REFERENCES delivery_orders(id),
  created_by  UUID REFERENCES user_accounts(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 16: EMPLOYEES, SALARIES & WAGES
-- =============================================================================

CREATE TABLE payroll_periods (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  period_type VARCHAR(20) NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      VARCHAR(20) DEFAULT 'open',
  created_by  UUID REFERENCES user_accounts(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE salary_records (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id         UUID NOT NULL REFERENCES contacts(id),
  payroll_period_id   UUID REFERENCES payroll_periods(id),
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  base_salary         DECIMAL(15,2) NOT NULL,
  currency            currency_type DEFAULT 'USD',
  overtime_hours      DECIMAL(8,2) DEFAULT 0,
  overtime_rate       DECIMAL(15,2) DEFAULT 0,
  overtime_amount     DECIMAL(15,2) DEFAULT 0,
  bonus               DECIMAL(15,2) DEFAULT 0,
  deductions          DECIMAL(15,2) DEFAULT 0,
  social_security     DECIMAL(15,2) DEFAULT 0,
  income_tax          DECIMAL(15,2) DEFAULT 0,
  net_salary          DECIMAL(15,2),
  delivery_count      INTEGER DEFAULT 0,
  delivery_rate       DECIMAL(15,2) DEFAULT 0,
  delivery_earnings   DECIMAL(15,2) DEFAULT 0,
  payment_date        DATE,
  payment_method      VARCHAR(30),
  status              VARCHAR(20) DEFAULT 'pending',
  approved_by         UUID REFERENCES user_accounts(id),
  approved_at         TIMESTAMPTZ,
  notes               TEXT,
  created_by          UUID REFERENCES user_accounts(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 17: EXPENSES
-- =============================================================================

CREATE TABLE expense_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  sub_account_id    UUID REFERENCES sub_accounts(id),
  expense_category  expense_category NOT NULL,
  expense_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  description       TEXT NOT NULL,
  amount            DECIMAL(15,2) NOT NULL,
  currency          currency_type DEFAULT 'USD',
  exchange_rate     DECIMAL(15,6) DEFAULT 1,
  vendor            VARCHAR(255),
  invoice_number    VARCHAR(100),
  payment_method    VARCHAR(30),
  document_url      TEXT,
  is_recurring      BOOLEAN DEFAULT FALSE,
  recurrence_type   VARCHAR(20),
  next_due_date     DATE,
  approved_by       UUID REFERENCES user_accounts(id),
  approved_at       TIMESTAMPTZ,
  status            VARCHAR(20) DEFAULT 'pending',
  notes             TEXT,
  created_by        UUID REFERENCES user_accounts(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE facility_subscriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  name              VARCHAR(255) NOT NULL,
  expense_category  expense_category NOT NULL,
  vendor            VARCHAR(255),
  contract_number   VARCHAR(100),
  start_date        DATE,
  end_date          DATE,
  monthly_amount    DECIMAL(15,2),
  currency          currency_type DEFAULT 'USD',
  payment_day       INTEGER,
  is_active         BOOLEAN DEFAULT TRUE,
  notes             TEXT,
  created_by        UUID REFERENCES user_accounts(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 18: REPORTS (Views)
-- =============================================================================

CREATE OR REPLACE VIEW v_daily_order_summary AS
SELECT
  do2.company_id,
  do2.branch_id,
  DATE(do2.created_at)                        AS report_date,
  do2.driver_id,
  c.first_name || ' ' || c.last_name          AS driver_name,
  COUNT(do2.id)                               AS total_orders,
  SUM(do2.total_amount)                       AS total_value,
  SUM(do2.collected_usd)                      AS collected_usd,
  SUM(do2.collected_lbp)                      AS collected_lbp,
  SUM(CASE WHEN do2.status = 'delivered'  THEN 1 ELSE 0 END) AS delivered_count,
  SUM(CASE WHEN do2.status = 'cancelled'  THEN 1 ELSE 0 END) AS cancelled_count
FROM delivery_orders do2
LEFT JOIN contacts c ON c.id = do2.driver_id
GROUP BY do2.company_id, do2.branch_id, DATE(do2.created_at), do2.driver_id, driver_name;

CREATE OR REPLACE VIEW v_driver_due_to_pay AS
SELECT
  do2.driver_id,
  c.first_name || ' ' || c.last_name         AS driver_name,
  c.mobile                                   AS driver_mobile,
  DATE(do2.delivered_at)                     AS delivery_date,
  COUNT(do2.id)                              AS orders_count,
  SUM(do2.total_amount)                      AS total_to_collect,
  SUM(do2.collected_usd)                     AS collected_usd,
  SUM(do2.collected_lbp)                     AS collected_lbp,
  SUM(do2.total_amount) - SUM(do2.collected_usd) AS balance_usd
FROM delivery_orders do2
JOIN contacts c ON c.id = do2.driver_id
WHERE do2.payment_status IN ('collected_by_driver', 'due_for_collection')
GROUP BY do2.driver_id, driver_name, driver_mobile, DATE(do2.delivered_at);

CREATE OR REPLACE VIEW v_credit_customer_balances AS
SELECT
  si.customer_id,
  c.first_name || ' ' || c.last_name         AS customer_name,
  c.mobile,
  c.email,
  COUNT(si.id)                               AS invoice_count,
  SUM(si.total_amount)                       AS total_invoiced,
  SUM(si.paid_amount)                        AS total_paid,
  SUM(si.balance_due)                        AS total_balance_due,
  MAX(si.due_date)                           AS latest_due_date
FROM sales_invoices si
JOIN contacts c ON c.id = si.customer_id
WHERE si.balance_due > 0
GROUP BY si.customer_id, customer_name, c.mobile, c.email;

-- =============================================================================
-- SECTION 19: AUDIT / ACTION LOG
-- =============================================================================

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID REFERENCES companies(id),
  user_id         UUID REFERENCES user_accounts(id),
  table_name      VARCHAR(100) NOT NULL,
  record_id       UUID NOT NULL,
  action          VARCHAR(30) NOT NULL,
  old_values      JSONB,
  new_values      JSONB,
  changed_fields  TEXT[],
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 20: NOTIFICATIONS
-- =============================================================================

CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID REFERENCES companies(id),
  recipient_id    UUID REFERENCES user_accounts(id),
  contact_id      UUID REFERENCES contacts(id),
  type            VARCHAR(50) NOT NULL,
  channel         VARCHAR(20) NOT NULL,
  subject         VARCHAR(255),
  body            TEXT,
  reference_type  VARCHAR(50),
  reference_id    UUID,
  status          VARCHAR(20) DEFAULT 'pending',
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SECTION 21: INDEXES FOR PERFORMANCE
-- =============================================================================

CREATE INDEX idx_contacts_mobile     ON contacts(mobile);
CREATE INDEX idx_contacts_type       ON contacts(contact_type);
CREATE INDEX idx_contacts_company    ON contacts(company_id);

CREATE INDEX idx_user_accounts_username ON user_accounts(username);
CREATE INDEX idx_user_accounts_mobile   ON user_accounts(mobile);
CREATE INDEX idx_user_accounts_role     ON user_accounts(role);

CREATE INDEX idx_orders_customer       ON delivery_orders(customer_id);
CREATE INDEX idx_orders_driver         ON delivery_orders(driver_id);
CREATE INDEX idx_orders_status         ON delivery_orders(status);
CREATE INDEX idx_orders_payment_status ON delivery_orders(payment_status);
CREATE INDEX idx_orders_created_at     ON delivery_orders(created_at);
CREATE INDEX idx_orders_scheduled_date ON delivery_orders(scheduled_date);
CREATE INDEX idx_orders_order_number   ON delivery_orders(order_number);

CREATE INDEX idx_otp_mobile     ON otp_logs(mobile);
CREATE INDEX idx_otp_reference  ON otp_logs(reference_id);
CREATE INDEX idx_otp_status     ON otp_logs(status);

CREATE INDEX idx_tracking_order          ON order_tracking(order_id);
CREATE INDEX idx_driver_locations_driver ON driver_locations(driver_id);
CREATE INDEX idx_driver_locations_time   ON driver_locations(recorded_at);

CREATE INDEX idx_inventory_product             ON inventory(product_id);
CREATE INDEX idx_inventory_transactions_product ON inventory_transactions(product_id);

CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_user         ON audit_logs(user_id);
CREATE INDEX idx_audit_created_at   ON audit_logs(created_at);

CREATE INDEX idx_expenses_date     ON expense_records(expense_date);
CREATE INDEX idx_expenses_category ON expense_records(expense_category);

CREATE INDEX idx_salary_employee ON salary_records(employee_id);
CREATE INDEX idx_salary_period   ON salary_records(period_start, period_end);

CREATE INDEX idx_fuel_vehicle        ON vehicle_fuel_logs(vehicle_id);
CREATE INDEX idx_fuel_date           ON vehicle_fuel_logs(fuel_date);
CREATE INDEX idx_maintenance_vehicle ON vehicle_maintenance(vehicle_id);

-- =============================================================================
-- SECTION 22: FUNCTIONS & TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  seq_val   INTEGER;
  order_num TEXT;
BEGIN
  SELECT COUNT(*) + 1 INTO seq_val
  FROM delivery_orders
  WHERE DATE(created_at) = CURRENT_DATE;

  order_num := 'ORD-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(seq_val::TEXT, 5, '0');
  NEW.order_number := order_num;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_order_number
BEFORE INSERT ON delivery_orders
FOR EACH ROW WHEN (NEW.order_number IS NULL)
EXECUTE FUNCTION generate_order_number();

CREATE OR REPLACE FUNCTION generate_contact_code()
RETURNS TRIGGER AS $$
DECLARE
  prefix  TEXT;
  seq_val INTEGER;
BEGIN
  prefix := CASE NEW.contact_type
    WHEN 'customer'   THEN 'CST'
    WHEN 'employee'   THEN 'EMP'
    WHEN 'driver'     THEN 'DRV'
    WHEN 'supplier'   THEN 'SUP'
    WHEN 'partner'    THEN 'PTN'
    WHEN 'contractor' THEN 'CON'
    ELSE 'OTH'
  END;

  SELECT COUNT(*) + 1 INTO seq_val
  FROM contacts WHERE contact_type = NEW.contact_type;

  NEW.code := prefix || '-' || LPAD(seq_val::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_contact_code
BEFORE INSERT ON contacts
FOR EACH ROW WHEN (NEW.code IS NULL)
EXECUTE FUNCTION generate_contact_code();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_branches_updated_at  BEFORE UPDATE ON branches   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_contacts_updated_at  BEFORE UPDATE ON contacts   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at    BEFORE UPDATE ON delivery_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at  BEFORE UPDATE ON products   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vehicles_updated_at  BEFORE UPDATE ON vehicles   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs(table_name, record_id, action, new_values)
    VALUES(TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs(table_name, record_id, action, old_values, new_values)
    VALUES(TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs(table_name, record_id, action, old_values)
    VALUES(TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_delivery_orders      AFTER INSERT OR UPDATE OR DELETE ON delivery_orders        FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_payment_collections  AFTER INSERT OR UPDATE OR DELETE ON payment_collections    FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_order_items          AFTER INSERT OR UPDATE OR DELETE ON order_items            FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_driver_settlements   AFTER INSERT OR UPDATE OR DELETE ON driver_daily_settlements FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_purchase_invoices    AFTER INSERT OR UPDATE OR DELETE ON purchase_invoices      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_otp_logs             AFTER INSERT OR UPDATE           ON otp_logs               FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE OR REPLACE FUNCTION update_inventory_on_transaction()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory (product_id, branch_id, quantity_on_hand)
  VALUES (NEW.product_id, NEW.branch_id, 0)
  ON CONFLICT (product_id, branch_id) DO NOTHING;

  IF NEW.transaction_type IN ('purchase', 'return') THEN
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand + NEW.quantity, last_updated = NOW()
    WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id;
  ELSIF NEW.transaction_type IN ('sale', 'damage') THEN
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand - NEW.quantity, last_updated = NOW()
    WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id;
  ELSIF NEW.transaction_type = 'adjustment' THEN
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand + NEW.quantity, last_updated = NOW()
    WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_inventory
AFTER INSERT ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION update_inventory_on_transaction();

ALTER TABLE inventory ADD CONSTRAINT uq_inventory_product_branch UNIQUE (product_id, branch_id);

-- =============================================================================
-- SECTION 23: ROW-LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

ALTER TABLE delivery_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;

-- Admins see everything in their company
CREATE POLICY orders_admin_policy ON delivery_orders
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid()
        AND ua.role IN ('super_admin', 'admin')
        AND ua.company_id = delivery_orders.company_id
    )
  );

-- Call center users see their company orders
CREATE POLICY orders_callcenter_policy ON delivery_orders
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid()
        AND ua.role = 'call_center'
        AND ua.company_id = delivery_orders.company_id
    )
  );

-- Drivers only see their own orders
CREATE POLICY orders_driver_policy ON delivery_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      JOIN contacts c ON c.id = ua.contact_id
      WHERE ua.id = auth.uid()
        AND ua.role = 'driver'
        AND c.id = delivery_orders.driver_id
    )
  );

-- Customers only see their own orders
CREATE POLICY orders_customer_policy ON delivery_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      JOIN contacts c ON c.id = ua.contact_id
      WHERE ua.id = auth.uid()
        AND ua.role = 'customer'
        AND c.id = delivery_orders.customer_id
    )
  );

-- Partners only see orders they created
CREATE POLICY orders_partner_policy ON delivery_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      JOIN contacts c ON c.id = ua.contact_id
      WHERE ua.id = auth.uid()
        AND ua.role = 'partner'
        AND c.id = delivery_orders.partner_id
    )
  );

-- Contacts: users can see contacts in their company
CREATE POLICY contacts_company_policy ON contacts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid()
        AND ua.company_id = contacts.company_id
    )
  );

-- User accounts: users see their own record; admins see all in company
CREATE POLICY user_accounts_self_policy ON user_accounts
  FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid()
        AND ua.role IN ('super_admin', 'admin')
        AND ua.company_id = user_accounts.company_id
    )
  );

-- Audit logs: admins only
CREATE POLICY audit_logs_admin_policy ON audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      WHERE ua.id = auth.uid()
        AND ua.role IN ('super_admin', 'admin')
    )
  );

-- Payment collections: admins and office staff
CREATE POLICY payment_collections_admin_policy ON payment_collections
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_accounts ua
      JOIN delivery_orders do2 ON do2.id = payment_collections.order_id
      WHERE ua.id = auth.uid()
        AND ua.role IN ('super_admin', 'admin', 'call_center')
        AND ua.company_id = do2.company_id
    )
  );

-- =============================================================================
-- SECTION 24: ENABLE REALTIME
-- =============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE delivery_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE driver_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE order_tracking;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- =============================================================================
-- SECTION 25: SEED DATA
-- =============================================================================

-- Insert a default company first
INSERT INTO companies (code, name, country, currency_default)
VALUES ('ID3-MAIN', 'iDeliver III', 'Lebanon', 'USD'::currency_type);

-- Insert delivery zones
INSERT INTO delivery_zones (company_id, name, base_fee, currency)
SELECT id, 'Downtown',    3.00, 'USD'::currency_type FROM companies WHERE code = 'ID3-MAIN'
UNION ALL
SELECT id, 'North Zone',  5.00, 'USD'::currency_type FROM companies WHERE code = 'ID3-MAIN'
UNION ALL
SELECT id, 'South Zone',  5.00, 'USD'::currency_type FROM companies WHERE code = 'ID3-MAIN'
UNION ALL
SELECT id, 'East Zone',   7.00, 'USD'::currency_type FROM companies WHERE code = 'ID3-MAIN'
UNION ALL
SELECT id, 'West Zone',   7.00, 'USD'::currency_type FROM companies WHERE code = 'ID3-MAIN'
UNION ALL
SELECT id, 'Mountain',   10.00, 'USD'::currency_type FROM companies WHERE code = 'ID3-MAIN';

-- Insert sample drivers (contacts with contact_type = 'driver')
INSERT INTO contacts (company_id, contact_type, first_name, last_name, mobile, email, driver_status, driver_license, notes)
SELECT
  c.id,
  'driver'::contact_type,
  d.first_name, d.last_name, d.mobile, d.email,
  d.driver_status::driver_status,
  d.license, d.notes
FROM companies c,
(VALUES
  ('Marco',   'Silva',   '+1 555 101 2020', 'marco@example.com',  'available', 'DL-1001', 'Covers downtown zone'),
  ('Anna',    'Lee',     '+1 555 202 3030', 'anna@example.com',   'on_duty',   'DL-1002', 'Priority customer driver'),
  ('James',   'Okafor',  '+1 555 303 4040', 'james@example.com',  'available', 'DL-1003', 'Handles large parcels'),
  ('Sofia',   'Reyes',   '+1 555 404 5050', 'sofia@example.com',  'available', 'DL-1004', 'Eco-friendly routes'),
  ('David',   'Chen',    '+1 555 505 6060', 'david@example.com',  'off_duty',  'DL-1005', 'Returns Monday')
) AS d(first_name, last_name, mobile, email, driver_status, license, notes)
WHERE c.code = 'ID3-MAIN';
