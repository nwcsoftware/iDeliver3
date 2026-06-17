-- =============================================================================
-- fix55: retail_goods_invoices — payment_type column
--
-- The order form's "External retail invoices references" section now lets the
-- user mark an invoice as paid (column `paid`, added in fix20) and record how it
-- was paid. This adds the `payment_type` column to store that (cash / card /
-- bank_transfer / cheque / other), mirroring delivery_packages.payment_type.
--
-- A retail invoice flagged paid is excluded from the order total (paid directly
-- to the shop), the same way a paid delivery package is.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE retail_goods_invoices
  ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30);
