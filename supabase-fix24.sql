-- =============================================================================
-- fix24: Order source (local vs external)
--
-- delivery_orders.order_source distinguishes orders entered in this app
-- ('LOCAL', the default) from orders brought in from an external system
-- ('EXTERNAL', set later by an import/API/SQL). Used by the daily orders list
-- filter. No UI sets it — it defaults to LOCAL.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS order_source VARCHAR(20) DEFAULT 'LOCAL';
