-- ============================================================================
-- fix39 — Account Transaction Summary View
-- ----------------------------------------------------------------------------
-- A flat, query-friendly view over account_transactions enriched with the
-- customer name, used by the "Account Transactions" page (filter / search /
-- multi-currency totals).
-- ============================================================================

CREATE OR REPLACE VIEW account_transaction_summary_view AS
SELECT
  at.transaction_id,
  at.transaction_date,
  at.transaction_number,
  at.order_number,
  at.order_id,
  at.transaction_type,
  at.transaction_reference,
  at.transaction_description,
  at.quantity,
  at.credit_amount,
  at.debit_amount,
  at.currency_code,
  at.exchange_rate,
  at.account_number,
  at.customer_id,
  COALESCE(
    NULLIF(TRIM(c.company_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
  ) AS customer_name,
  at.company_id,
  at.branch_id,
  at.created_by
FROM account_transactions at
LEFT JOIN contacts c ON c.id = at.customer_id;

-- Let the app (anon) read the view. The view runs with its owner's rights, so
-- it reads the underlying tables regardless of their RLS (read-only summary).
GRANT SELECT ON account_transaction_summary_view TO anon, authenticated;
