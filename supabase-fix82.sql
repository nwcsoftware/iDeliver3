-- =============================================================================
-- fix82 — Partner payouts (money the office actually hands a partner)
-- -----------------------------------------------------------------------------
-- A partner's package is collected from the customer UNLESS it is flagged
-- delivery_packages.paid ("Paid directly to <partner>"), in which case the
-- customer settled with the partner and we owe nothing for it. Everything else
-- we collect on the partner's behalf and owe back — so a partner runs a balance:
--
--   dues = delivered packages − paid directly to partner − paid to partner
--
-- The first two terms are already derivable from delivery_packages. The third
-- was not recorded ANYWHERE: v_supplier_settlements.paid_total (fix71) is just
-- SUM(CASE WHEN rgi.paid ...), which re-reads the "paid directly" flag rather
-- than any payout. Without this table "paid directly" and "paid to partner"
-- collapse into the same number and the dues formula double-subtracts it.
--
--   partner_payouts — one row per payment made TO a partner. Multi-currency:
--                     one row per (partner, currency, payout), matching how
--                     credit_customer_payments (fix63) handles the mirror case
--                     of a customer paying US.
--
-- Reversible: deleting a payout row restores the dues it settled. Nothing here
-- touches orders, packages or payment_collections.
--
-- dev_anon RLS so the app's anon key can read/write. Safe to run multiple times.
-- =============================================================================

CREATE TABLE IF NOT EXISTS partner_payouts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID REFERENCES companies(id),
  partner_id     UUID NOT NULL REFERENCES contacts(id),
  amount         DECIMAL(15,2) NOT NULL,
  currency       currency_type DEFAULT 'USD',
  method         VARCHAR(30) DEFAULT 'cash',   -- cash, card, bank_transfer, cheque, other
  paid_at        TIMESTAMPTZ DEFAULT NOW(),
  notes          TEXT,
  paid_by        UUID REFERENCES user_accounts(id),
  paid_by_name   TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- "All payouts for this partner" — the balance lookup on every page load.
CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner
  ON partner_payouts (partner_id);

-- Date-ranged sweeps ("what did we pay out this month").
CREATE INDEX IF NOT EXISTS idx_partner_payouts_paid_at
  ON partner_payouts (paid_at DESC);

ALTER TABLE partner_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_partner_payouts" ON partner_payouts;
CREATE POLICY "dev_anon_partner_payouts" ON partner_payouts
  FOR ALL TO anon USING (true) WITH CHECK (true);
