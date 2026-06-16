-- ============================================================================
-- fix43 — Track returnable items directly on order_items
-- ----------------------------------------------------------------------------
-- Returnable items are now tracked straight from the order. Any order_item whose
-- product is_returnable is an "issued" returnable (issue date = added_at, driver
-- and recipient come from its order). These columns record the return.
-- order_items has no RLS, so no policy is needed.
-- ============================================================================

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_returned BOOLEAN DEFAULT FALSE;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS returned_by TEXT;   -- username who marked it returned
