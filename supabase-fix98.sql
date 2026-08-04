-- ============================================================================
-- fix98 — shop_inventory: per-partner/supplier shop items for the customer app
-- ----------------------------------------------------------------------------
-- Each partner/supplier maintains their OWN shop inventory (separate from the
-- admin `products` catalog). Every item is owned by that contact
-- (owner_contact_id) and can be shown to / hidden from the customer app via the
-- is_displayed flag. Displayed + active items are listed publicly in the customer
-- app's shop. company_id (tenant) is kept alongside for multi-company setups.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shop_inventory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The partner/supplier contact that owns this item ("my inventory" scope).
  owner_contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  company_id       uuid,                         -- tenant company (optional)
  name             text NOT NULL,
  description      text,
  price            numeric(14,2) NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'USD',
  image_url        text,
  stock_qty        numeric,
  category         text,
  -- Shown in the customer app shop when TRUE (and active).
  is_displayed     boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_inventory_owner_idx     ON public.shop_inventory(owner_contact_id);
CREATE INDEX IF NOT EXISTS shop_inventory_displayed_idx ON public.shop_inventory(is_displayed) WHERE is_displayed;

-- RLS: the app talks to Supabase with the anon key, so an RLS-enabled table needs
-- a policy or reads come back empty and writes are rejected. Ownership ("my items
-- only") is enforced client-side by owner_contact_id; the customer app reads only
-- displayed+active rows.
ALTER TABLE public.shop_inventory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shop_inventory' AND policyname = 'shop_inventory_all'
  ) THEN
    CREATE POLICY shop_inventory_all ON public.shop_inventory
      FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
