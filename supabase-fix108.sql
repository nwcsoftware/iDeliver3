-- ============================================================================
-- fix108 — how a broadcast announces itself
-- ----------------------------------------------------------------------------
-- The super admin chooses per message:
--   'popup' (default) — takes over the screen the moment it arrives, as before
--   'icon'            — no popup; the sidebar messages icon just badges the
--                       unread count and gives a short nudge animation, and the
--                       user opens it when they want
--
-- Existing messages default to 'popup', so nothing changes for them.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.broadcast_messages
  ADD COLUMN IF NOT EXISTS display_mode text DEFAULT 'popup';

UPDATE public.broadcast_messages
   SET display_mode = 'popup'
 WHERE display_mode IS NULL OR display_mode NOT IN ('popup', 'icon');

NOTIFY pgrst, 'reload schema';
