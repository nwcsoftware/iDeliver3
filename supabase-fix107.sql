-- ============================================================================
-- fix107 — targeted broadcast messages
-- ----------------------------------------------------------------------------
-- A broadcast can now be aimed at specific roles and/or specific accounts
-- instead of always going to everyone:
--
--   audience_roles     text[]  — e.g. {call_center,supplier}; empty = any role
--   audience_user_ids  uuid[]  — specific user_accounts.id values
--
-- BOTH empty (the default, and what every existing message has) = send to
-- everyone, so messages sent before this migration keep behaving as they did.
-- When both are set, a user matches if EITHER their role OR their id is listed.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.broadcast_messages
  ADD COLUMN IF NOT EXISTS audience_roles    text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS audience_user_ids uuid[] DEFAULT '{}'::uuid[];

UPDATE public.broadcast_messages SET audience_roles    = '{}'::text[] WHERE audience_roles    IS NULL;
UPDATE public.broadcast_messages SET audience_user_ids = '{}'::uuid[] WHERE audience_user_ids IS NULL;

NOTIFY pgrst, 'reload schema';
