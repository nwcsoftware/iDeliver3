-- =============================================================================
-- fix84 — Product kind becomes a single choice: Retail / Returnable / Service /
--          Advertisement
-- -----------------------------------------------------------------------------
-- The product form used independent flags (is_retail + is_deliverable +
-- is_returnable + is_service), so an item could be several things at once and its
-- code prefix was ambiguous. Kind is now ONE choice, which is what drives the
-- serial code: PRD (retail) / RTN (returnable) / SRV (service) / ADV (advert).
--
-- The flags stay as separate booleans rather than one `kind` column because
-- is_returnable is load-bearing — ReturnableItemsPage filters on it — and this
-- keeps that working untouched. The form is what enforces "exactly one".
--
-- is_deliverable is dropped from the form but the COLUMN is kept: nothing reads
-- it today, and removing a column is not reversible.
--
-- Backfill makes every existing row exactly one kind:
--   • Rows already flagged returnable STAY returnable. They are genuinely
--     returnable (gas bottles, shisha) and ReturnableItemsPage keys off that
--     flag — forcing them to Retail would silently empty that page and lose
--     which items were returnable. Flip them by hand if that's not wanted.
--   • Everything else becomes Retail.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_advertisement BOOLEAN DEFAULT FALSE;

-- 1. An item that is returnable / service / advert is not Retail.
UPDATE products
   SET is_retail = FALSE
 WHERE COALESCE(is_returnable, FALSE)
    OR COALESCE(is_service, FALSE)
    OR COALESCE(is_advertisement, FALSE);

-- 2. Everything with no kind left becomes Retail.
UPDATE products
   SET is_retail = TRUE
 WHERE NOT COALESCE(is_returnable,   FALSE)
   AND NOT COALESCE(is_service,      FALSE)
   AND NOT COALESCE(is_advertisement, FALSE);

-- Check: every row should now have exactly one kind (expect 0 rows back).
SELECT id, code, name, is_retail, is_returnable, is_service, is_advertisement
FROM products
WHERE (COALESCE(is_retail,FALSE)::int + COALESCE(is_returnable,FALSE)::int
     + COALESCE(is_service,FALSE)::int + COALESCE(is_advertisement,FALSE)::int) <> 1;
