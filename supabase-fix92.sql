-- =============================================================================
-- fix92 — record who locked (closed) an order
-- -----------------------------------------------------------------------------
-- Orders are locked via the isclosed flag. We already stamp closed_by (the user's
-- id) + closed_at, but the UI had no readable name to show. This adds
-- closed_by_name so every locked order can display "Locked by <name>" without an
-- extra users lookup. Locking stays open to any user; UNLOCKING is restricted to
-- super admins in the app.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS closed_by_name text;

-- Reload the PostgREST schema cache so the API returns the new column immediately.
NOTIFY pgrst, 'reload schema';
