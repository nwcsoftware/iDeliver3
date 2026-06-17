-- ============================================================================
-- fix58 — retail_goods_invoices.paid: default TRUE
-- ----------------------------------------------------------------------------
-- fix20 created the column as `paid BOOLEAN DEFAULT FALSE`. This flips the
-- default so a new invoice row is "paid" unless told otherwise.
--
-- NOTE: a DEFAULT only applies when an INSERT omits the column. Existing rows
-- are unchanged, and the order form currently always sends `paid` explicitly
-- (EMPTY_RETAIL_INVOICE.paid = false in DeliveriesPage), so this default won't
-- change what the app stores until that form default is also flipped.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE retail_goods_invoices ALTER COLUMN paid SET DEFAULT true;
