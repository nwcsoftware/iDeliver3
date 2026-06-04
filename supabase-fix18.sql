-- =============================================================================
-- fix18: Order type
--
-- Adds an order_type (business/merchant category) to delivery_orders, set from
-- the order form: restaurant, supermarket, taxi, sweets, flowers, bakery.
-- Stored as free text so new categories can be added without a migration.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(30);
