-- ============================================================================
-- fix125 — header banners are stored as FILES, not as text inside the row
-- ----------------------------------------------------------------------------
-- Until now an uploaded banner was kept as a data URL in header_backgrounds.
-- That is base64, so the stored text ran ~33% larger than the file, and every
-- user pulled the whole thing down on every sign-in: a 20 MB clip meant 27 MB
-- of text fetched by everyone, every session.
--
-- This bucket fixes it at the root. The app uploads the picture or movie here
-- and saves only its URL, so the row stays a few hundred bytes and the browser
-- streams the media directly from storage — cached, resumable, and served in
-- parallel with the rest of the app instead of blocking it.
--
-- The bucket is PUBLIC because the header renders for everyone, including
-- before a session is fully established. Nothing private belongs in it.
--
-- Safe to run multiple times.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'header-media', 'header-media', true,
  52428800,                                        -- 50 MB ceiling at the storage layer
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif',
        'video/mp4','video/webm','video/ogg','video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Same dev anon posture as the rest of the app's tables: the client holds only
-- the publishable key, so it needs these rights to upload and to read back.
DROP POLICY IF EXISTS "header_media_read"   ON storage.objects;
DROP POLICY IF EXISTS "header_media_write"  ON storage.objects;
DROP POLICY IF EXISTS "header_media_update" ON storage.objects;
DROP POLICY IF EXISTS "header_media_delete" ON storage.objects;

CREATE POLICY "header_media_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'header-media');

CREATE POLICY "header_media_write" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'header-media');

CREATE POLICY "header_media_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'header-media')
  WITH CHECK (bucket_id = 'header-media');

CREATE POLICY "header_media_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'header-media');

NOTIFY pgrst, 'reload schema';
