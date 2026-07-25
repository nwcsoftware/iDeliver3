-- =============================================================================
-- fix88 — Track commission collection on retail_goods_invoices
-- -----------------------------------------------------------------------------
-- "We bought" (is_procurement) invoices earn this shop's commission at month-end
-- (commission_rate / commission_amount, fix71/fix86). That is a SEPARATE fact
-- from whether the goods invoice itself was paid (retail_goods_invoices.paid):
-- a shop can settle the invoice value yet still owe us the commission, or vice
-- versa. So commission collection gets its own flag rather than overloading
-- `paid`.
--
-- Adds:
--   commission_collected      — has the commission been collected from the shop?
--   commission_collected_at   — when it was marked collected (audit)
--   commission_collected_by   — which user marked it collected (audit)
--
-- Only meaningful on is_procurement = TRUE rows (the only ones that carry a
-- commission). Existing rows default to FALSE (not yet collected).
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE retail_goods_invoices
  ADD COLUMN IF NOT EXISTS commission_collected    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commission_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commission_collected_by UUID;
