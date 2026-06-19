-- fix59 — payment_collections: record who collected each payment
-- ----------------------------------------------------------------------------
-- When an office user records a payment from the daily order list ("Record
-- payment") or the order form's Payments section, we now stamp who took it:
--   * collected_by      — the signed-in user's account id (already in the base
--                          schema; ensured here in case an older DB lacks it).
--   * collected_by_name — denormalised full name, so the amounts summary popup
--                          can show "Collected by <name>" without a join.
--
-- A payment that carries a collected_by_name was taken by the office (paid to
-- office directly), which means the driver never handled that cash — so the
-- driver-settlement (Driver Dues) page excludes it from what the driver owes.
-- Legacy payments (collected_by_name IS NULL) keep counting as driver-collected.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE payment_collections
  ADD COLUMN IF NOT EXISTS collected_by      UUID REFERENCES user_accounts(id);

ALTER TABLE payment_collections
  ADD COLUMN IF NOT EXISTS collected_by_name TEXT;
