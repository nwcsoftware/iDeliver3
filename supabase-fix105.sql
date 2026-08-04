-- ============================================================================
-- fix105 — up to 3 photos per shop item
-- ----------------------------------------------------------------------------
-- shop_inventory.image_url (a single data-URL photo) becomes
-- shop_inventory.images (text[], max 3 enforced by the app). The first image is
-- still mirrored into image_url so older readers keep showing a photo.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.shop_inventory
  ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}'::text[];

-- Backfill: the existing single photo becomes the first gallery image.
UPDATE public.shop_inventory
   SET images = ARRAY[image_url]
 WHERE COALESCE(btrim(image_url), '') <> ''
   AND (images IS NULL OR cardinality(images) = 0);

UPDATE public.shop_inventory
   SET images = '{}'::text[]
 WHERE images IS NULL;

NOTIFY pgrst, 'reload schema';
