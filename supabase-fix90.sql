-- =============================================================================
-- fix90 — retail_goods_invoices.paid → exclude_calculation
-- -----------------------------------------------------------------------------
-- The "paid" flag on retail_goods_invoices was renamed to exclude_calculation
-- (an invoice flagged true is settled directly by the customer with the shop, so
-- it is EXCLUDED from the order total / pending). This script:
--   1. Completes the rename if it hasn't been applied (idempotent).
--   2. Rebuilds the v_supplier_settlements view against the new column name
--      (its paid_total / unpaid_total output columns are unchanged).
--   3. Reloads the PostgREST (Supabase API) schema cache so the app stops
--      erroring on the old column name.
--
-- Safe to run multiple times.
-- =============================================================================

-- 1) Rename the column only if the old name is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_goods_invoices' AND column_name = 'paid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_goods_invoices' AND column_name = 'exclude_calculation'
  ) THEN
    ALTER TABLE public.retail_goods_invoices RENAME COLUMN paid TO exclude_calculation;
  END IF;
END $$;

-- Belt & suspenders: guarantee the column exists with a sane default. The app
-- always sends an explicit value, so the default is only for hand-inserted rows.
ALTER TABLE public.retail_goods_invoices
  ADD COLUMN IF NOT EXISTS exclude_calculation BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Rebuild the supplier-settlement view against exclude_calculation. Output
--    columns are identical, so CREATE OR REPLACE is accepted. "Paid" here means
--    settled directly by the customer (excluded from the amount we owe the shop).
CREATE OR REPLACE VIEW v_supplier_settlements AS
SELECT
  rgi.company_id                                                        AS company_id,
  rgi.contact_id                                                        AS supplier_id,
  c.code                                                                AS supplier_code,
  COALESCE(NULLIF(TRIM(c.company_name), ''),
           TRIM(CONCAT(c.first_name, ' ', c.last_name)))                AS supplier_name,
  c.credit_debit_allowed                                               AS is_credit_shop,
  date_trunc('month', COALESCE(rgi.invoice_date, o.created_at::date))::date AS month,
  rgi.currency                                                          AS currency,
  COUNT(*)                                                              AS invoice_count,
  SUM(rgi.invoice_value)                                                AS purchases_total,
  SUM(CASE WHEN COALESCE(rgi.is_procurement, FALSE)
           THEN COALESCE(rgi.commission_amount, 0) ELSE 0 END)         AS commission_total,
  SUM(CASE WHEN rgi.exclude_calculation THEN rgi.invoice_value ELSE 0 END)  AS paid_total,
  SUM(CASE WHEN rgi.exclude_calculation THEN 0 ELSE rgi.invoice_value END)  AS unpaid_total
FROM retail_goods_invoices rgi
JOIN delivery_orders o ON o.id = rgi.order_id
JOIN contacts       c ON c.id = rgi.contact_id
WHERE rgi.contact_id IS NOT NULL
GROUP BY
  rgi.company_id, rgi.contact_id, c.code, c.company_name, c.first_name, c.last_name,
  c.credit_debit_allowed,
  date_trunc('month', COALESCE(rgi.invoice_date, o.created_at::date)),
  rgi.currency;

GRANT SELECT ON v_supplier_settlements TO anon;
GRANT SELECT ON v_supplier_settlements TO authenticated;

-- 3) Reload the PostgREST schema cache so the API immediately sees the new column.
NOTIFY pgrst, 'reload schema';

-- A view runs with its CREATOR's rights unless told otherwise, which would
-- bypass row-level security for every anon query (Supabase flags that as
-- critical). security_invoker makes it run as the CALLER. See fix122.
ALTER VIEW public.v_supplier_settlements SET (security_invoker = on);
