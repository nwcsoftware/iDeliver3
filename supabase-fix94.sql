-- =============================================================================
-- fix94 — ads table (for "Ads & Services" / Story orders)
-- -----------------------------------------------------------------------------
-- A Story order (order_type = 'Story') can carry one or more ads. Each ad is a row
-- here, linked to its delivery_orders row. The order number and customer number /
-- name are denormalized onto the ad (as requested) so the ad can be listed and
-- reported without joining back every time.
--
-- One ad row holds: the platform it runs on, its start and end date+time, and its
-- price with currency.
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid,
  -- Link to the order this ad belongs to (cascade so ads vanish with the order).
  order_id        uuid REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  order_number    text,                         -- denormalized from the order
  -- Customer (contact) the ad is for, plus denormalized number + name.
  customer_id     uuid REFERENCES public.contacts(id),
  customer_number text,                         -- account number / code
  customer_name   text,
  -- Where the ad is placed (e.g. Facebook, Instagram, TikTok, Billboard, Radio…).
  platform        text,
  -- Ad run window — full date + time on both ends.
  start_at        timestamptz,                  -- ads start date & time
  end_at          timestamptz,                  -- ads end date & time
  -- Price of the ad + its currency.
  price           numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ads_order_id_idx    ON public.ads(order_id);
CREATE INDEX IF NOT EXISTS ads_customer_id_idx ON public.ads(customer_id);
CREATE INDEX IF NOT EXISTS ads_company_id_idx  ON public.ads(company_id);

-- RLS: the app talks to Supabase with the anon key, so an RLS-enabled table needs a
-- policy or every read comes back empty and every write is rejected.
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ads' AND policyname = 'ads_all'
  ) THEN
    CREATE POLICY ads_all ON public.ads
      FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Reload the PostgREST schema cache so the API sees the new table immediately.
NOTIFY pgrst, 'reload schema';
