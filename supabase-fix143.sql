-- =============================================================================
-- fix143 — shop photographs move out of the database and into storage
-- -----------------------------------------------------------------------------
-- The shop pages read every photograph with FileReader.readAsDataURL and wrote
-- the result straight into the row. So `shop_inventory.images` and
-- `products.images` held base64 text — a 750 KB photograph becomes about 1 MB
-- of it — and the customer app's gallery query dragged all of it down before it
-- could draw a single card.
--
-- Measured on this install, four displayed items:
--
--   the same rows, WITHOUT the image columns ...........    3 KB,   0.5 s
--   the same rows, as the customer app asks ............ 2423 KB,  54.9 s
--
-- Of that 2423 KB, 906 KB was the cover photograph stored a SECOND time in
-- `image_url` — byte for byte identical to images[0] on every row.
--
-- Base64 in a row is slow in a way that gets worse rather than better:
--
--   · The bytes travel inside a JSON response, so the browser cannot cache them
--     as images, cannot reuse them between screens, and cannot lazily skip the
--     ones below the fold — `loading="lazy"` is meaningless on a data: URL that
--     has already been downloaded.
--   · Nothing renders until the LAST byte of the LAST photograph arrives. A
--     page with the same weight in real image files shows its text at once and
--     fills the pictures in as they land.
--   · Every visit pays the whole cost again.
--
-- So the photographs go where photographs go. This migration provides:
--
--   1. A public `shop-media` bucket, on the same terms as the `header-media`
--      bucket fix125 created for the header and the landing clip. Rows then
--      hold a short URL and the browser streams the file from storage.
--
--   2. A backfill making `images` authoritative. Rows written before fix105
--      have a cover in `image_url` and nothing in `images`; the customer app
--      therefore had to ask for BOTH columns on every query, which is what made
--      the duplicate expensive. With every cover present in `images`, the app
--      can stop asking for `image_url` altogether — see CustomerMobileApp.
--
-- The base64 already sitting in existing rows is NOT converted here: SQL cannot
-- decode a data URL and hand the bytes to the storage API. `scripts/lift-shop-
-- images.cjs` does that, and should be run once after this migration.
--
-- Nothing breaks if it is not run. A data: URL in `images` still renders
-- exactly as it did — it is just as slow as it was.
--
-- Safe to run multiple times.
-- =============================================================================

-- ── where the photographs live ──────────────────────────────────────────────
-- 8 MB a file. Generous for a photograph that is displayed a couple of inches
-- wide, and far below the 50 MB the header bucket allows for video: the point
-- of this migration is that these are served to a phone on mobile data.
--
-- image/avif earns its place on evidence rather than on principle: of the 18
-- pictures found sitting in rows on this install, 11 were AVIF — it is what a
-- browser hands you when you save a picture off most modern sites, so it is
-- what ends up on a shop owner's desktop and then in their item.
--
-- HEIC/HEIF are deliberately NOT here, though an iPhone shoots them. No browser
-- but Safari will decode one in an <img>, so allowing them would trade an
-- upload error the owner can act on for a broken picture in the customer app
-- that nobody notices. shopMedia.js turns one away with a message instead.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shop-media', 'shop-media', true,
  8388608,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/avif']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Same four policies the header bucket carries (fix125). Reading is the whole
-- point — these are pictures on a public shop front — and the writer is the
-- anon key because that is what every screen in this app authenticates as.
DROP POLICY IF EXISTS "shop_media_read"   ON storage.objects;
DROP POLICY IF EXISTS "shop_media_write"  ON storage.objects;
DROP POLICY IF EXISTS "shop_media_update" ON storage.objects;
DROP POLICY IF EXISTS "shop_media_delete" ON storage.objects;

CREATE POLICY "shop_media_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'shop-media');

CREATE POLICY "shop_media_write" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'shop-media');

CREATE POLICY "shop_media_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'shop-media')
  WITH CHECK (bucket_id = 'shop-media');

CREATE POLICY "shop_media_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'shop-media');

-- ── make `images` the one place a photograph is listed ──────────────────────
-- A row from before fix105 kept its only picture in `image_url`. Lifting it
-- into `images` is what lets the customer app drop `image_url` from its select,
-- which is where the duplicate cover was costing 906 KB a page load.
--
-- `images` is a text[] (fix105 for shop_inventory, fix116 for products), NOT a
-- jsonb array — unlike `colors`, `options` and `combos` beside it, which are
-- jsonb. The two look identical coming back through PostgREST, which is an easy
-- way to write a migration that will not run.
UPDATE public.shop_inventory
   SET images = ARRAY[image_url]::text[]
 WHERE image_url IS NOT NULL
   AND btrim(image_url) <> ''
   AND COALESCE(cardinality(images), 0) = 0;

UPDATE public.products
   SET images = ARRAY[image_url]::text[]
 WHERE image_url IS NOT NULL
   AND btrim(image_url) <> ''
   AND COALESCE(cardinality(images), 0) = 0;

-- An empty array rather than NULL, so every reader can treat the column the same.
UPDATE public.shop_inventory SET images = '{}'::text[] WHERE images IS NULL;
UPDATE public.products       SET images = '{}'::text[] WHERE images IS NULL;

-- ── what is still stored the expensive way ──────────────────────────────────
-- Run scripts/lift-shop-images.cjs to move these into the bucket.
SELECT
  (SELECT count(*) FROM public.shop_inventory
    WHERE array_to_string(images, ',') LIKE '%data:image%') AS shop_items_with_base64,
  (SELECT count(*) FROM public.products
    WHERE array_to_string(images, ',') LIKE '%data:image%') AS products_with_base64;

NOTIFY pgrst, 'reload schema';
