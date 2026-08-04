-- ============================================================================
-- fix99 — order_items.shop_item_id: link customer-app order lines to the shop item
-- ----------------------------------------------------------------------------
-- When a customer orders from the shop, each order_items row records WHICH shop
-- product it came from. order_items.product_id is reserved for the admin `products`
-- catalog (it has a FK to products), and shop items live in shop_inventory, so we
-- add a separate shop_item_id → shop_inventory(id).
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS shop_item_id uuid REFERENCES public.shop_inventory(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_items_shop_item_idx ON public.order_items(shop_item_id);

NOTIFY pgrst, 'reload schema';
