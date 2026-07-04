-- supabase-fix78.sql
-- "Free order" flag on delivery_orders.
-- ----------------------------------------------------------------------------
-- Lets the order form mark an order as free of charge: its total is waived to
-- zero even when it carries items, so it can be closed with no payment. We keep
-- an audit trail of who flipped it and when.
--   • is_free_order  — the toggle itself
--   • free_marked_by — the signed-in user who set it free (contacts/users id)
--   • free_marked_at — when it was set free
-- Safe to re-run.
-- ============================================================================
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS is_free_order  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_marked_by uuid,
  ADD COLUMN IF NOT EXISTS free_marked_at timestamptz;
