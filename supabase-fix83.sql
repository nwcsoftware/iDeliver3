-- =============================================================================
-- fix83 — Services as a product kind (products.is_service)
-- -----------------------------------------------------------------------------
-- products carried flags for is_retail / is_deliverable / is_returnable but had
-- no way to say "this is a service, not a thing". That distinction matters:
--
--   • A service cannot be stored, so it must never carry a stock figure.
--   • The item's code prefix is driven by its kind — PRD / SRV / RTN — and
--     without this column a service is indistinguishable from a product.
--
-- Kind is derived, not stored twice: service → SRV, else returnable → RTN,
-- else PRD (see src/lib/productCode.js). A service is never returnable — the
-- product form enforces that the two flags are mutually exclusive.
--
-- Existing rows default to FALSE, i.e. everything already in the table stays a
-- product. Codes are NOT rewritten: products.code is shown to users and printed
-- on price lists, so renumbering history is a separate, deliberate decision.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_service BOOLEAN DEFAULT FALSE;

-- The product form looks up the highest existing code per prefix on every add,
-- and checks a candidate for collisions before inserting.
CREATE INDEX IF NOT EXISTS idx_products_code ON products (code);

-- A service is not stockable and cannot be returnable.
UPDATE products SET is_returnable = FALSE WHERE is_service = TRUE AND is_returnable = TRUE;
