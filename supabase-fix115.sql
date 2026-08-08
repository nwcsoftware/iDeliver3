-- ============================================================================
-- fix115 — show a catalog product in the customer app
-- ----------------------------------------------------------------------------
-- The customer app's "3asari3" shop tab lists the office Products catalog, so
-- each product needs its own switch for whether customers see it — the same
-- "Show this item in the customer app" flag the supplier's shop items have.
--
-- Existing products default to NOT shown, so nothing appears in the customer
-- app until someone deliberately publishes it.
--
-- (products.image_url already exists — the product photo needs no migration.)
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_displayed boolean DEFAULT false;

UPDATE public.products SET is_displayed = false WHERE is_displayed IS NULL;

NOTIFY pgrst, 'reload schema';
