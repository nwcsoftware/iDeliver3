-- ============================================================================
-- fix167 — RETIRED. DO NOT RUN. Run supabase-fix168.sql instead.
-- ----------------------------------------------------------------------------
-- fix167 was written to move the 131 Gallon 20 L returns of 28 Sep to the
-- empties and mark every other Gallon line returned (expected: filled 22,
-- empty 255). Before it was run, the office counted the shelf and entered the
-- real figures by hand (−132 filled, +17 empty). Running fix167 now would move
-- the 128 returns a second time and add 255 empties on top of that count.
--
-- It stops here without changing anything. fix168 does the one part that is
-- still needed.
-- ============================================================================

DO $$
BEGIN
  RAISE EXCEPTION 'fix167 is retired: the Gallon count was entered by hand. Run supabase-fix168.sql instead.';
END $$;
