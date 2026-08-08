-- ============================================================================
-- fix113 — supplier stock: movements (in/out) + cart reservations
-- ----------------------------------------------------------------------------
-- Two tables behind the supplier's inventory monitor:
--
--   shop_inventory_movements — the stock ledger for a shop item
--       'in'     stock received / added by the supplier
--       'out'    stock removed (damage, returns to supplier, corrections)
--       'sold'   written automatically when a customer's order is placed
--     Quantity is always POSITIVE; the type decides the sign.
--     On hand = Σ in − Σ out − Σ sold.
--
--   shop_reservations — a customer's cart holds stock without consuming it.
--     One row per cart line, replaced as the quantity changes and deleted when
--     the line is removed. On checkout the row is deleted and a 'sold' movement
--     takes its place. `expires_at` keeps abandoned carts from holding stock
--     forever (the app only counts reservations that haven't expired).
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shop_inventory_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID,
  item_id           UUID NOT NULL REFERENCES public.shop_inventory(id) ON DELETE CASCADE,
  owner_contact_id  UUID,                      -- the shop this item belongs to
  movement_type     TEXT NOT NULL DEFAULT 'in',-- in | out | sold
  quantity          NUMERIC NOT NULL DEFAULT 0,
  notes             TEXT,
  order_id          UUID,                      -- set on 'sold' rows
  created_by        UUID,
  created_by_name   TEXT,
  moved_at          TIMESTAMPTZ DEFAULT NOW(), -- the movement's own date
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_reservations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID,
  item_id           UUID NOT NULL REFERENCES public.shop_inventory(id) ON DELETE CASCADE,
  owner_contact_id  UUID,
  customer_id       UUID,                      -- contacts.id of the shopper
  cart_line_key     TEXT,                      -- productId::colour::size
  variant_label     TEXT,
  quantity          NUMERIC NOT NULL DEFAULT 1,
  expires_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 days'),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- One reservation row per customer per cart line, so re-adding just updates it.
CREATE UNIQUE INDEX IF NOT EXISTS shop_reservations_line_key
  ON public.shop_reservations (customer_id, cart_line_key);

CREATE INDEX IF NOT EXISTS shop_inventory_movements_item_idx ON public.shop_inventory_movements (item_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS shop_inventory_movements_owner_idx ON public.shop_inventory_movements (owner_contact_id);
CREATE INDEX IF NOT EXISTS shop_reservations_item_idx        ON public.shop_reservations (item_id);
CREATE INDEX IF NOT EXISTS shop_reservations_owner_idx       ON public.shop_reservations (owner_contact_id);

-- Same dev anon policy as the rest of the app's tables (the customer app writes
-- reservations before any staff session exists).
ALTER TABLE public.shop_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_reservations        ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_shop_inventory_movements" ON public.shop_inventory_movements;
CREATE POLICY "dev_anon_shop_inventory_movements"
  ON public.shop_inventory_movements FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "dev_anon_shop_reservations" ON public.shop_reservations;
CREATE POLICY "dev_anon_shop_reservations"
  ON public.shop_reservations FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
