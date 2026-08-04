-- ============================================================================
-- fix101 — record the device a user signs in from
-- ----------------------------------------------------------------------------
-- The super admin needs to see, in Settings → User Accounts, which machine each
-- user is signed in on. Live sessions come from Realtime presence (client-side);
-- these columns keep the LAST device seen so it still shows when the user is
-- offline.
--
--   last_login_device    → readable name ("NICOL-PC (nicol)", "Chrome on Android")
--   last_login_device_id → stable random id per install/browser profile
--   last_login_platform  → win32 | darwin | linux | web platform string
--   last_device_seen_at  → when that device was last used to open the app
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.user_accounts
  ADD COLUMN IF NOT EXISTS last_login_device    text,
  ADD COLUMN IF NOT EXISTS last_login_device_id text,
  ADD COLUMN IF NOT EXISTS last_login_platform  text,
  ADD COLUMN IF NOT EXISTS last_device_seen_at  timestamptz;

-- Called by the client right after a successful sign-in and on session
-- rehydrate. SECURITY DEFINER so it can write regardless of RLS, but it only
-- ever touches the device columns of the given user.
CREATE OR REPLACE FUNCTION public.record_login_device(
  p_user_id     uuid,
  p_device_name text,
  p_device_id   text DEFAULT NULL,
  p_platform    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR COALESCE(btrim(p_device_name), '') = '' THEN
    RETURN;
  END IF;

  UPDATE public.user_accounts
     SET last_login_device    = left(btrim(p_device_name), 120),
         last_login_device_id = p_device_id,
         last_login_platform  = p_platform,
         last_device_seen_at  = now()
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_login_device(uuid, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
