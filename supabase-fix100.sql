-- ============================================================================
-- fix100 — supplier commission on customer-app order lines
-- ----------------------------------------------------------------------------
-- 1) contacts.partner_percentage_type — whether a supplier/partner's commission %
--    is an ADDITION (added on top of the line) or a DEDUCTION (taken off the line).
-- 2) order_items gets the supplier + commission snapshot, filled by the customer
--    app when a customer adds a shop item:
--      supplier_id           → the shop's contact (shop_inventory.owner_contact_id)
--      supplier_name         → the shop/supplier display name
--      commission_percentage → the supplier's partner_percentage at order time
--      partner_percentage_type → 'addition' | 'deduction' (snapshot)
--      commission_amount     → line_total × percentage / 100 (magnitude)
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS partner_percentage_type text;   -- 'addition' | 'deduction'

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS supplier_id             uuid REFERENCES public.contacts(id),
  ADD COLUMN IF NOT EXISTS supplier_name           text,
  ADD COLUMN IF NOT EXISTS commission_percentage   numeric,
  ADD COLUMN IF NOT EXISTS partner_percentage_type text,
  ADD COLUMN IF NOT EXISTS commission_amount       numeric;

CREATE INDEX IF NOT EXISTS order_items_supplier_idx ON public.order_items(supplier_id);

NOTIFY pgrst, 'reload schema';
