-- ============================================================================
-- fix114 — "prepared on request" shop items
-- ----------------------------------------------------------------------------
-- Food is made to order (sandwiches, pizza…), so it has no stock to count.
-- Flagging an item as made-to-order means:
--   • the supplier's inventory monitor shows demand instead of stock levels
--   • the customer app never shows "available / out of stock" for it, and never
--     blocks adding it to the cart — it shows how many have been ordered so the
--     customer can see how popular it is
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.shop_inventory
  ADD COLUMN IF NOT EXISTS is_made_to_order boolean DEFAULT false;

UPDATE public.shop_inventory SET is_made_to_order = false WHERE is_made_to_order IS NULL;

NOTIFY pgrst, 'reload schema';
