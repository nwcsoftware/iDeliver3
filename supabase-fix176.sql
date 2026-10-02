-- ============================================================================
-- fix176 — the super admin can hide test accounts from everyone else
-- ----------------------------------------------------------------------------
-- Trial accounts (Admin01, jad, partner01.testing and its contact PTN-000088,
-- the "jad test" driver) were being counted and listed like real ones. The
-- super admin can now mark a login, a contact or a subscription HIDDEN:
--
--   * nobody but the super admin sees it on any page;
--   * the super admin still sees it on the pages, marked hidden;
--   * it is left out of every total, seat count, due and PDF — for everyone;
--   * a hidden login can still sign in.
--
-- WHAT THIS ADDS
--   is_hidden on user_accounts, contacts and subscriptions (default false).
--   super_admin_set_hidden(actor, kind, id, hidden) — the only way to set it,
--   applied together:
--     login         its subscriptions, and the contact behind it
--     contact       its logins and all its subscriptions
--     subscription  that row only
--
-- Hiding is enforced by the application, not the database: everyone signs in
-- through one key, so a row-level policy cannot tell the super admin apart.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.contacts      ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.super_admin_set_hidden(p_actor_id UUID, p_kind TEXT, p_id UUID, p_hidden BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_contact UUID;
  v_n INTEGER := 0;
  v_k INTEGER;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id);
  IF p_hidden IS NULL THEN RAISE EXCEPTION 'HIDDEN_REQUIRED'; END IF;

  IF p_kind = 'subscription' THEN
    UPDATE subscriptions SET is_hidden = p_hidden WHERE id = p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END IF;

  IF p_kind = 'login' THEN
    SELECT contact_id INTO v_contact FROM user_accounts WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF (SELECT role::TEXT FROM user_accounts WHERE id = p_id) = 'super_admin' THEN RAISE EXCEPTION 'CANNOT_HIDE_SUPER_ADMIN'; END IF;
    UPDATE user_accounts SET is_hidden = p_hidden WHERE id = p_id;
    UPDATE subscriptions SET is_hidden = p_hidden WHERE user_account_id = p_id;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := 1 + v_k;
  ELSIF p_kind = 'contact' THEN
    v_contact := p_id;
  ELSE
    RAISE EXCEPTION 'BAD_KIND';
  END IF;

  -- The contact, its logins, and all its subscriptions go together.
  IF v_contact IS NOT NULL THEN
    UPDATE contacts SET is_hidden = p_hidden WHERE id = v_contact;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
    UPDATE user_accounts SET is_hidden = p_hidden WHERE contact_id = v_contact AND role::TEXT <> 'super_admin';
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
    UPDATE subscriptions SET is_hidden = p_hidden
     WHERE contact_id = v_contact
        OR user_account_id IN (SELECT id FROM user_accounts WHERE contact_id = v_contact);
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  END IF;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.super_admin_set_hidden(UUID, TEXT, UUID, BOOLEAN) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: the three columns present, nothing hidden yet (0 / 0 / 0), the
-- function installed. Hiding is then done from the pages by the super admin.
SELECT 'column' AS what, table_name::TEXT AS detail FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'is_hidden'
   AND table_name IN ('user_accounts', 'contacts', 'subscriptions')
UNION ALL
SELECT 'hidden logins', (SELECT COUNT(*) FROM user_accounts WHERE is_hidden)::TEXT
UNION ALL
SELECT 'hidden contacts', (SELECT COUNT(*) FROM contacts WHERE is_hidden)::TEXT
UNION ALL
SELECT 'hidden subscriptions', (SELECT COUNT(*) FROM subscriptions WHERE is_hidden)::TEXT
UNION ALL
SELECT 'installed', proname::TEXT FROM pg_proc WHERE proname = 'super_admin_set_hidden';
