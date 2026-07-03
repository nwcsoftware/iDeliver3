-- supabase-fix72.sql
-- Reset order_source on delivery_orders to "Call center".
--
-- Context: the app used to derive an order's source from the *customer's* contact
-- type, so call-center orders placed for a partner/supplier contact were wrongly
-- tagged 'partner'/'supplier' and shown as unconfirmed "outside" orders. The app
-- code now only tags an order as partner/supplier when a 2nd-party user is signed
-- in. This migration cleans up the historical rows.
--
-- The app writes the value as 'Call center' (lowercase c); keep that exact spelling
-- so new and existing rows match and the list's confirm-icon logic stays consistent.

-- ── OPTION A (SAFE, RECOMMENDED) ─────────────────────────────────────────────
-- Only fix rows wrongly tagged as partner/supplier. Leaves genuine online/app
-- orders (order_source starting with 'EXT') untouched, and also confirms them so
-- they stop showing the "outside order" / not-confirmed treatment.
UPDATE public.delivery_orders
SET
  order_source  = 'Call center',
  order_confirmed = TRUE,
  confirmed_at  = COALESCE(confirmed_at, now())
WHERE lower(coalesce(order_source, '')) IN ('partner', 'supplier');

-- ── OPTION B (BLUNT) ─────────────────────────────────────────────────────────
-- Set EVERY order's source to 'Call center', including real online (EXTERNAL)
-- and partner-portal orders. This erases those source markers. Uncomment to use.
--
-- UPDATE public.delivery_orders
-- SET order_source = 'Call center';
