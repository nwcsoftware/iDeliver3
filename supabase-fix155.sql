-- ============================================================================
-- fix155 — activating an advert takes the reminder off everybody's screen
-- ----------------------------------------------------------------------------
-- When an advert's start time arrives the app floats a "ready to start"
-- reminder. One user presses Activate, `ads.confirmed_ads` becomes true, and
-- the reminder goes from THEIR screen. Everyone else kept seeing it.
--
-- Because an advert lives in its own table. The app listens to
-- `delivery_orders` over realtime, and setting confirmed_ads touches no order
-- row, so no event was ever sent: every other screen went on asking for work
-- that was already done, and the only way out of the popup was to dismiss a
-- reminder about something somebody else had finished.
--
-- Activation belongs to the ADVERT, not to whoever happened to see it first.
-- So `ads` joins the realtime publication, the app follows the change, and the
-- order it belongs to is refreshed — which re-reads its embedded adverts and
-- takes the reminder down everywhere at once.
--
-- The same table also carries price, platform and the run dates, so any of
-- those edited by one user now reaches the others as it happens rather than at
-- the next full reload.
--
-- This buys immediacy, not correctness: without it the app still catches up on
-- its next refresh. Safe to run multiple times.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ads;
    RAISE NOTICE 'added ads to supabase_realtime';
  ELSE
    RAISE NOTICE 'ads was already published';
  END IF;
END $$;

/* REPLICA IDENTITY FULL, so a DELETE arrives carrying the row it removed.
   Postgres sends only the primary key otherwise, and the app needs order_id
   off the old row to know WHICH order to refresh — with just an id it would
   have nothing to look up and the reminder would outlive the advert. */
ALTER TABLE public.ads REPLICA IDENTITY FULL;

-- ── check ───────────────────────────────────────────────────────────────────
-- `ads` must appear here beside delivery_orders.

SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('ads', 'delivery_orders', 'order_items', 'order_services',
                    'delivery_packages', 'retail_goods_invoices')
ORDER BY tablename;
