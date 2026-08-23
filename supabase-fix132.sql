-- ============================================================================
-- fix132 — the order lines a 2nd party is named on go out over realtime
-- ----------------------------------------------------------------------------
-- A supplier or partner sees an order when something on it names them: a
-- package they handed us, an invoice from their shop, one of their products
-- sold in the customer app, a service they performed — or the order being
-- raised for them in the first place.
--
-- Those lines are written AFTER the order row: the customer app inserts the
-- order and then its items. `delivery_orders` is already published for
-- realtime, so the order arrives on their screen instantly — but at that
-- moment it doesn't name them yet, so their portal cannot tell it is theirs.
--
-- Publishing the line tables too closes that gap: the insert that makes the
-- order theirs is itself the event that reveals it. Each subscription is
-- filtered to the one contact, so a shop only ever receives its own rows.
--
-- Without this the portal still catches up — it re-asks once a minute — so
-- this migration buys immediacy, not correctness.
--
-- Safe to run multiple times.
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_packages', 'retail_goods_invoices', 'order_items', 'order_services']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'added % to supabase_realtime', t;
    END IF;
  END LOOP;
END $$;

-- What the portal can now be told about as it happens.
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('delivery_orders', 'delivery_packages', 'retail_goods_invoices',
                    'order_items', 'order_services')
ORDER BY tablename;
