-- ============================================================================
-- fix109 — scheduled header background images
-- ----------------------------------------------------------------------------
-- The super admin uploads an image and a date window; while that window is
-- current, every user's app header (the control bar at the top of the window)
-- shows it as a background. Display only — nobody interacts with it.
--
--   name        — label for the admin's own list ("Ramadan", "Christmas")
--   image_url   — data URL of the picture
--   start_at    — when it starts showing (NULL = immediately)
--   end_at      — when it stops (NULL = no end)
--   opacity     — 0.05–1.00, how strongly it shows behind the header content
--   is_active   — off switch that ignores the dates entirely
--
-- Overlapping windows are allowed; the app shows the most recently created one
-- that is currently in range.
--
-- Safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.header_backgrounds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID,
  name        TEXT,
  image_url   TEXT NOT NULL,
  start_at    TIMESTAMPTZ,
  end_at      TIMESTAMPTZ,
  opacity     NUMERIC DEFAULT 0.35,
  is_active   BOOLEAN DEFAULT TRUE,
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS header_backgrounds_window_idx
  ON public.header_backgrounds (is_active, start_at, end_at);

-- Same dev anon policy as the rest of the app's tables: every signed-in client
-- must be able to READ the current banner (it renders for all users).
ALTER TABLE public.header_backgrounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_header_backgrounds" ON public.header_backgrounds;
CREATE POLICY "dev_anon_header_backgrounds"
  ON public.header_backgrounds FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
