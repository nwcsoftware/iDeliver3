-- =============================================================================
-- iDeliver III Customer App - Step 1 Database Readiness
-- Run this in Supabase SQL Editor before public customer registration/order flows.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS credit_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS default_delivery_address TEXT;

COMMENT ON COLUMN contacts.credit_approved IS
  'Staff-controlled flag. Approved credit customers may place credit orders; all others use cash on delivery.';

COMMENT ON COLUMN contacts.credit_limit IS
  'Optional staff-controlled credit limit for customer accounts.';

COMMENT ON COLUMN contacts.default_pickup_address IS
  'Optional saved pickup address for customer delivery bookings.';

COMMENT ON COLUMN contacts.default_delivery_address IS
  'Optional saved delivery address for customer delivery bookings.';

CREATE INDEX IF NOT EXISTS idx_contacts_customer_credit
  ON contacts (company_id, credit_approved)
  WHERE contact_type = 'customer';

