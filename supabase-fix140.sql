-- =============================================================================
-- fix140 — a public front page, before anyone signs in
-- -----------------------------------------------------------------------------
-- Until now the web build opened on the sign-in box, which tells a visitor who
-- is not a user precisely nothing. This adds a public landing page: a welcome,
-- news about 3asari3, a few headline figures, galleries of event photographs
-- the admin uploads, and a QR code a phone can scan to fetch the customer app.
--
-- Two tables, because the page is two different things:
--
--   landing_settings — the page's own furniture. One row is used (the newest
--                      published one); the rest are history. Holds the welcome
--                      copy, the background clip, the app link and the headline
--                      figures.
--   landing_posts    — the changing content: one row per news item or event.
--                      An event carries a date and a set of pictures with
--                      captions, which the page draws as a gallery.
--
-- READ BY THE PUBLIC. This is the one part of the schema deliberately exposed
-- to a visitor who has not signed in — the page renders with the anon key
-- before any session exists. Nothing here is personal or financial: it is the
-- copy, the pictures and the figures the company chooses to publish. Anything
-- unpublished is still readable by anon (the app filters on `is_published`), so
-- do NOT stage anything confidential in a draft row.
--
-- Pictures and the background clip live in the existing `header-media` bucket
-- (fix125 / fix133) under a `landing/` prefix — the row holds a short URL, and
-- the browser streams the file straight from storage.
--
-- Safe to run multiple times.
-- =============================================================================

-- ── the page's furniture ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID,
  -- Off switch for the whole page. With nothing published the web build falls
  -- back to the sign-in box, exactly as it behaved before this migration.
  is_published      BOOLEAN DEFAULT TRUE,
  headline          TEXT,
  tagline           TEXT,
  -- The welcome note. Blank lines separate paragraphs; no markup is parsed.
  intro             TEXT,
  -- Background clip + its poster frame (shown while the clip loads, and instead
  -- of it when the visitor has asked for reduced motion).
  video_url         TEXT,
  poster_url        TEXT,
  -- How strongly the clip shows through the dark scrim the text sits on.
  video_opacity     NUMERIC DEFAULT 0.45,
  -- What the QR code encodes, and the words beside it.
  app_download_url  TEXT,
  app_note          TEXT,
  -- Headline figures: [{ "label": "Orders delivered", "value": "48,000", "note": "since 2024" }]
  stats             JSONB   DEFAULT '[]'::jsonb,
  -- Optional footer contact line: [{ "label": "Call us", "value": "+961 …" }]
  contacts          JSONB   DEFAULT '[]'::jsonb,
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── the changing content ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID,
  -- 'news'  — an announcement, shown as a card
  -- 'event' — something that happened on a day, shown as a dated gallery
  kind          TEXT NOT NULL DEFAULT 'news',
  title         TEXT,
  -- The context that goes with the pictures. Blank lines separate paragraphs.
  body          TEXT,
  -- The day the event happened / the news is dated to. What the page sorts on,
  -- newest first; a row without one falls back to created_at.
  event_date    DATE,
  location      TEXT,
  -- [{ "url": "https://…", "caption": "…" }] — order in the array is the order
  -- in the gallery, so the admin can arrange them.
  images        JSONB   DEFAULT '[]'::jsonb,
  is_published  BOOLEAN DEFAULT TRUE,
  -- Pins a post above the rest regardless of its date (higher wins).
  sort_order    INTEGER DEFAULT 0,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS landing_posts_published_idx
  ON public.landing_posts (is_published, sort_order DESC, event_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS landing_settings_published_idx
  ON public.landing_settings (is_published, created_at DESC);

-- A row created before this column existed has no kind; treat it as news
-- rather than letting it fall out of both lists.
UPDATE public.landing_posts SET kind = 'news' WHERE kind IS NULL OR btrim(kind) = '';

-- ── row level security ──────────────────────────────────────────────────────
-- The same dev anon policy the rest of the app's tables carry. It matters more
-- here than elsewhere: without a policy a table with RLS enabled returns an
-- empty set with no error, and the front page would render blank for everyone
-- with nothing to say why.
ALTER TABLE public.landing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_landing_settings" ON public.landing_settings;
CREATE POLICY "dev_anon_landing_settings"
  ON public.landing_settings FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE public.landing_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_landing_posts" ON public.landing_posts;
CREATE POLICY "dev_anon_landing_posts"
  ON public.landing_posts FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── a page to look at on first run ──────────────────────────────────────────
-- Inserted only when the table is empty, so re-running this file never
-- overwrites what the admin has since written.
INSERT INTO public.landing_settings (headline, tagline, intro, app_note, stats, is_published)
SELECT
  'Welcome to 3asari3',
  'Deliveries, shops and stories — across Lebanon.',
  E'3asari3 moves orders between the shops people buy from and the doors they live behind.\n\nEvery delivery is tracked from the moment it is raised to the moment it is handed over, and every partner we carry for can see their own goods and their own money at any time.',
  'Scan to install the 3asari3 customer app on your phone.',
  '[{"label":"Deliveries completed","value":"—","note":"and counting"},{"label":"Partner shops","value":"—","note":"across the country"},{"label":"Cities served","value":"—","note":""}]'::jsonb,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.landing_settings);

NOTIFY pgrst, 'reload schema';
