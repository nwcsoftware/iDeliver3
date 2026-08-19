-- ============================================================================
-- fix124 — the header banner may be a looping movie, not only a picture
-- ----------------------------------------------------------------------------
-- The super admin can now schedule a short clip made for the header strip
-- (1920 × 50 px). It plays muted, loops for ever, and is as decorative as the
-- image was — no controls, no sound, nothing to click.
--
--   media_type  'image' (default, every existing row) or 'video'
--   image_url   keeps its name and its job: the media itself, either a data URL
--               from an upload or a link to a file hosted elsewhere. Renaming
--               the column would break every deployment mid-flight for no gain.
--   poster_url  optional still shown while a video loads, or if it cannot play
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.header_backgrounds
  ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS poster_url TEXT;

-- Existing rows are pictures.
UPDATE public.header_backgrounds SET media_type = 'image' WHERE media_type IS NULL;

NOTIFY pgrst, 'reload schema';
