-- =============================================================================
-- fix13: Order-level discount currency
--
-- The order-level discount can now be in a currency independent of the
-- delivery-fee / primary currency (e.g. a discount in LBP on a USD order).
-- Per-item discounts are unaffected — they are always in each item's own
-- currency.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS discount_currency currency_type DEFAULT 'USD';
