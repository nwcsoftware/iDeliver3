-- ============================================================================
-- fix116 — catalog products get photos, colours and sizes
-- ----------------------------------------------------------------------------
-- The customer app's 3asari3 shop lists the office Products catalog, so those
-- products need the same presentation as a supplier's shop item:
--
--   images  text[]  — up to 3 photos (the first is the cover); image_url keeps
--                     the cover so anything still reading it works
--   colors  jsonb   — [{ "name": "Red", "image": "<data-url|null>" }, …]
--   sizes   text[]  — ['S','M','L'] or ['20L','0.5L'], free-form labels
--
-- All default to empty: a product without them behaves exactly as before.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS colors jsonb  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sizes  text[] DEFAULT '{}'::text[];

-- Backfill: an existing single photo becomes the first gallery image.
UPDATE public.products
   SET images = ARRAY[image_url]
 WHERE COALESCE(btrim(image_url), '') <> ''
   AND (images IS NULL OR cardinality(images) = 0);

UPDATE public.products SET images = '{}'::text[] WHERE images IS NULL;
UPDATE public.products SET colors = '[]'::jsonb  WHERE colors IS NULL;
UPDATE public.products SET sizes  = '{}'::text[] WHERE sizes  IS NULL;

NOTIFY pgrst, 'reload schema';
