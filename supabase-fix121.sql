-- ============================================================================
-- fix121 — favourites, and shop working hours
-- ----------------------------------------------------------------------------
-- 1. customer_favourites
--    A customer hearts an item in the shop and finds it again later. A row
--    points at EITHER a shop_inventory item (a supplier's goods) or a products
--    row (3asari3's own catalog) — never both.
--
-- 2. contacts.opening_hours
--    When a shop is open. A JSON array of seven entries, Sunday first, each
--    { "closed": false, "from": "09:00", "to": "22:00" }; a missing or empty
--    value means the shop keeps no hours and is treated as always open, so
--    nothing changes for shops that never fill this in.
--
--    contacts.hours_note carries a free line the shop can show customers
--    ("Closed Sundays and public holidays").
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customer_favourites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_contact_id UUID NOT NULL,          -- contacts.id of the customer
  shop_item_id        UUID,                   -- shop_inventory.id  (supplier goods)
  product_id          UUID,                   -- products.id        (3asari3 catalog)
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT customer_favourites_target_ck
    CHECK (num_nonnulls(shop_item_id, product_id) = 1)
);

-- One heart per customer per item, so tapping twice can only toggle.
CREATE UNIQUE INDEX IF NOT EXISTS customer_favourites_item_uq
  ON public.customer_favourites (customer_contact_id, shop_item_id)
  WHERE shop_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_favourites_product_uq
  ON public.customer_favourites (customer_contact_id, product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_favourites_customer_idx
  ON public.customer_favourites (customer_contact_id, created_at DESC);

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opening_hours JSONB,
  ADD COLUMN IF NOT EXISTS hours_note    TEXT;

-- Same dev anon policy as the rest of the app's tables.
ALTER TABLE public.customer_favourites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_customer_favourites" ON public.customer_favourites;
CREATE POLICY "dev_anon_customer_favourites"
  ON public.customer_favourites FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
