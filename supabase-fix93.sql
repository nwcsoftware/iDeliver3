-- =============================================================================
-- fix93 — super-admin "lock order" (separate from closing)
-- -----------------------------------------------------------------------------
-- A super admin can lock an order to freeze it against any edits by users or
-- admins, independently of whether it's closed. This is stored server-side so the
-- lock applies to every signed-in user everywhere (any machine / location), and
-- propagates via the existing delivery_orders realtime channel.
--
--   is_locked      — true while the order is locked.
--   is_locked_by   — name of the super admin who locked it (cleared on unlock).
--   why_is_locked  — the reason the super admin typed (cleared on unlock).
--
-- Only a super admin may unlock (enforced in the app).
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS is_locked     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_locked_by  text,
  ADD COLUMN IF NOT EXISTS why_is_locked text;

-- Reload the PostgREST schema cache so the API returns the new columns at once.
NOTIFY pgrst, 'reload schema';
