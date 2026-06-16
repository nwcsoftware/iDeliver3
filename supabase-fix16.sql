-- =============================================================================
-- fix16: Order main account
--
-- Stores the customer/partner contact's account_number on the order itself as
-- `main_account`. The app fills this automatically from the selected contact's
-- account_number when an order is created/edited; it is not user-editable.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS main_account VARCHAR(20);
