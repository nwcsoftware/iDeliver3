-- =============================================================================
-- fix80 — Cashier Box reset checkpoints (hide box movements as of a date)
-- -----------------------------------------------------------------------------
-- The Daily Cashier Box has no data of its own — it is derived live from closed
-- orders' payment_collections / packages / services, which are the SAME records
-- driver settlements and orders use. So "reset only the cashier box" cannot mean
-- deleting anything; it means HIDING those movements from the box.
--
-- This adds a checkpoint table (mirrors credit_customer_clears / fix64): the box
-- excludes every movement dated (by closed_at) on or before the latest
-- reset_through. Orders, payments and driver settlements are untouched, and the
-- reset is fully reversible (delete the checkpoint row to bring them back).
--
--   cashier_box_resets — one row per reset action. The ACTIVE checkpoint is the
--                        row with the latest reset_through (per company).
--
-- Also retires the destructive fix79 delete function: resetting the box now hides
-- movements instead of deleting shared order/payment data.
--
-- dev_anon RLS so the app's anon key can read/write. Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS cashier_box_resets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID REFERENCES companies(id),
  reset_through    DATE NOT NULL,                 -- box cleared up to & including this date
  created_by       UUID REFERENCES user_accounts(id),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- "Latest reset" lookups.
CREATE INDEX IF NOT EXISTS idx_cashier_box_resets_through
  ON cashier_box_resets (reset_through DESC);

ALTER TABLE cashier_box_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_cashier_box_resets" ON cashier_box_resets;
CREATE POLICY "dev_anon_cashier_box_resets" ON cashier_box_resets
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Retire the destructive fix79 reset (it deleted shared order/payment/settlement
-- rows). The read-only preview_cashier_box_reset(date) is kept — it still lists
-- which closed orders' movements a checkpoint would hide.
DROP FUNCTION IF EXISTS reset_cashier_box_through(date, uuid);
