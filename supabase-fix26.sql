-- =============================================================================
-- fix26: Link retail_goods_invoices to a contact (supplier / shop)
--
-- Many retail goods invoices belong to one contact (the supplier/shop they were
-- issued by): a many-to-one relation, contact_id -> contacts(id). On contact
-- delete we keep the invoice history but clear the link (ON DELETE SET NULL).
--
-- contact_code denormalises the contact's `code` onto the invoice so the app
-- can fill it from the contacts table when a shop is selected (handy for
-- reporting without a join, and stable even if the contact is later removed).
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE retail_goods_invoices
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE retail_goods_invoices
  ADD COLUMN IF NOT EXISTS contact_code VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_retail_goods_invoices_contact
  ON retail_goods_invoices(contact_id);
