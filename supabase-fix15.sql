-- =============================================================================
-- fix15: Delivery package pricing & payment
--
-- Adds per-package pricing and payment info to delivery_packages:
--   base_price    - the base price of the package
--   package_price - the charged package price
--   paid          - whether the package has been paid
--   payment_type  - how it was paid (cash, card, bank_transfer, cheque, other)
--
-- Prices are in the order's currency.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_packages ADD COLUMN IF NOT EXISTS base_price    DECIMAL(15,2);
ALTER TABLE delivery_packages ADD COLUMN IF NOT EXISTS package_price DECIMAL(15,2);
ALTER TABLE delivery_packages ADD COLUMN IF NOT EXISTS paid          BOOLEAN DEFAULT FALSE;
ALTER TABLE delivery_packages ADD COLUMN IF NOT EXISTS payment_type  VARCHAR(20);
