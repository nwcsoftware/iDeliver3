-- =============================================================================
-- fix89 — Backfill payment_collections.collection_group + collected_by_name
--         from the free-text notes, for driver collections.
-- -----------------------------------------------------------------------------
-- collection_group was added manually. For any payment whose notes mention a
-- driver collection (e.g. "Cash collected by driver: Aabass Diab — Full payment"):
--   • collection_group  = 'Driver'
--   • collected_by_name = the name between ": " and the " — " separator
--                         (here → "Aabass Diab")
--
-- Name extraction: everything after the first ':' up to a dash that is padded by
-- spaces on both sides ( — / – / - ). Requiring spaces around the dash means a
-- hyphenated name like "Jean-Paul" is NOT split. If no such separator exists, we
-- fall back to the rest of the line after ':'; if even that yields nothing, the
-- existing collected_by_name is kept.
--
-- Safe to run multiple times.
-- =============================================================================

UPDATE public.payment_collections
SET
  collection_group  = 'Driver',
  collected_by_name = COALESCE(
    NULLIF(btrim(substring(notes from ':[[:space:]]*(.+?)[[:space:]]+[-—–][[:space:]]+')), ''),
    NULLIF(btrim(substring(notes from ':[[:space:]]*(.+)$')), ''),
    collected_by_name
  )
WHERE notes ILIKE '%driver%';
