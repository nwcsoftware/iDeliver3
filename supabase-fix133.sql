-- ============================================================================
-- fix133 — scheduled seasonal themes for the customer app
-- ----------------------------------------------------------------------------
-- fix109/124/125 let the super admin schedule a decorative banner behind the
-- office header. This is the same idea on the customer's phone, and further:
-- as well as a background movie it REPAINTS the app — Ramadan indigo and
-- lantern gold, Christmas red and pine, the blue of high summer.
--
--   theme_key   one of the themes in src/lib/customerThemes.js
--   media_url   a clip authored for a phone screen (1080 × 1920), kept in the
--               header-media bucket from fix125 — the row holds a URL, never
--               the file, so a phone streams it instead of downloading a
--               base64 copy on every start
--   poster_url  the still shown before the clip plays, and instead of it for
--               anyone who asked their phone to reduce motion
--   starts_on / ends_on   the window, as DAYS: a theme "until 25/12" covers
--               the whole of Christmas Day
--   overlay     0…1, how far the video is dimmed so text stays readable
--
-- Windows may overlap: the app shows the most SPECIFIC live row — a dated
-- occasion beats an open-ended everyday theme, a short window beats a long
-- one — so a theme left running all year cannot swallow Christmas.
--
-- Nothing here is required. With no row scheduled the app looks exactly as it
-- always has.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customer_themes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID,
  theme_key   TEXT NOT NULL DEFAULT 'default',
  name        TEXT,
  media_url   TEXT,
  media_type  TEXT,                      -- 'video' when a clip is attached
  poster_url  TEXT,
  starts_on   DATE,
  ends_on     DATE,
  overlay     NUMERIC DEFAULT 0.55,
  is_active   BOOLEAN DEFAULT TRUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_themes_window_idx
  ON public.customer_themes (is_active, starts_on, ends_on);

-- Same dev anon posture as the rest of the app's tables: the customer app has
-- to read this before anyone signs in.
ALTER TABLE public.customer_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_customer_themes" ON public.customer_themes;
CREATE POLICY "dev_anon_customer_themes"
  ON public.customer_themes FOR ALL TO anon USING (true) WITH CHECK (true);

-- The clips live in the fix125 bucket, under their own prefix. Re-asserted
-- here so this migration stands alone if fix125 was never run.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'header-media', 'header-media', true,
  52428800,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif',
        'video/mp4','video/webm','video/ogg','video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

SELECT count(*) AS scheduled_themes FROM public.customer_themes;

NOTIFY pgrst, 'reload schema';
