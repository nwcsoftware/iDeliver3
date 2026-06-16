-- ============================================================================
-- fix50 — Per-package currency on delivery packages
-- ----------------------------------------------------------------------------
-- Package pricing was always counted in the order's primary currency. The order
-- form now lets each package carry its own currency (next to Package Price), so
-- a single order can hold packages priced in different currencies. Stored as
-- currency_type to match order_items / order_services.
-- ============================================================================

ALTER TABLE delivery_packages
  ADD COLUMN IF NOT EXISTS currency currency_type DEFAULT 'USD';
