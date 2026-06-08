-- =============================================================================
-- fix25: Supplier business type (contacts.shop_type)
--
-- Adds a business-type classification to supplier contacts (supermarket /
-- grocery / bakery / restaurant / sweets / flowers / other), entered on the
-- Suppliers form as "BUISINESS TYPE". When a shop is selected in an order's
-- "External Retails Invoices References" section, the app auto-fills the
-- invoice's shop_type from this column, and records created_by as the
-- signed-in user (retail_goods_invoices already has both columns — see fix20).
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS shop_type VARCHAR(30);
