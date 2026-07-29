-- =============================================================================
-- fix91 — global (company-wide) app settings for super-admin restrictions
-- -----------------------------------------------------------------------------
-- The super-admin restriction toggles (lock saved local-market invoices, protect
-- other users' payments) were stored per-device in each browser's localStorage,
-- so turning a restriction ON only affected that one desktop. These are company
-- POLICY, not personal preferences — a super admin must be able to set them once
-- and have them apply to every signed-in user, on any device, in any location.
--
-- This creates a single-row table holding those settings as JSON. The app reads
-- it on start-up and subscribes to realtime changes, so a toggle propagates to
-- every client immediately. Only the restriction keys live here; per-device
-- preferences (reminders, order window) stay in localStorage.
--
-- Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_global_settings (
  id         text PRIMARY KEY DEFAULT 'global',
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.app_global_settings ENABLE ROW LEVEL SECURITY;

-- Dev/anon access policy (this app talks to Supabase with the anon key). Without a
-- policy an RLS-enabled table returns no rows and rejects writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'app_global_settings'
      AND policyname = 'app_global_settings_all'
  ) THEN
    CREATE POLICY app_global_settings_all
      ON public.app_global_settings
      FOR ALL
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Seed the single row with the current defaults (only if it isn't there yet, so
-- re-running never clobbers a super admin's chosen values).
INSERT INTO public.app_global_settings (id, settings)
VALUES ('global', '{"lockSavedLocalInvoices": true, "protectOthersPayments": false}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Reload the PostgREST schema cache so the API sees the new table immediately.
NOTIFY pgrst, 'reload schema';
