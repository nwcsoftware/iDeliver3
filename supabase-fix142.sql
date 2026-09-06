-- =============================================================================
-- fix142 — a news post chooses which side its picture sits on
-- -----------------------------------------------------------------------------
-- The news cards (fix140) were laid out entirely by arithmetic: two to a row,
-- picture on top, and whichever card was left over at the end took the whole
-- row and turned side-on with its picture on the left. Good default, no say in
-- it. An admin writing a piece where the photograph IS the story, or where it
-- ought to sit to the right of the words for once, had no way to ask.
--
-- One column on landing_posts:
--
--   image_side — 'auto'  : as before. A half-width card with the picture on
--                          top; widened to a side-on card, picture left, only
--                          if it would otherwise be left alone on its row.
--                'left'  : always a full-width card, picture to the left.
--                'right' : always a full-width card, picture to the right.
--
-- Choosing a side implies the full width, and that is deliberate rather than a
-- limitation: half of a two-column grid is around 380px on a laptop, and a
-- picture and a paragraph side by side inside that is two unreadable columns.
-- Asking for a side is asking for the room to have one.
--
-- Below the `md` breakpoint every card stacks with the picture on top whatever
-- this says. A phone is one column wide; there is no left or right to choose.
--
-- Deliberately NOT constrained to those three values. The client clamps
-- anything it does not recognise back to 'auto' (normalisePost in
-- lib/landingPage.js), so an unknown value degrades to the old behaviour
-- instead of refusing the row — which is the right way round for a decorative
-- setting on a public page.
--
-- Events are unaffected: they keep the automatic rule. The column lives on the
-- shared table, so extending it to them later needs no migration.
--
-- Safe to run multiple times. Requires supabase-fix140.sql.
-- =============================================================================

ALTER TABLE public.landing_posts
  ADD COLUMN IF NOT EXISTS image_side TEXT DEFAULT 'auto';

-- Rows written before this column existed have NULL. They were laid out by the
-- automatic rule, which is exactly what 'auto' means, so nothing moves.
UPDATE public.landing_posts
   SET image_side = 'auto'
 WHERE image_side IS NULL OR btrim(image_side) = '';

NOTIFY pgrst, 'reload schema';
