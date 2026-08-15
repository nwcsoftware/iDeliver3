-- =============================================================================
-- fix86 — Per-invoice procurement flag on local-market invoices
-- -----------------------------------------------------------------------------
-- "We purchased these goods" used to be one order-level flag
-- (delivery_orders.is_procurement, fix71): the whole order either earned shop
-- commission or not. In practice a single delivery can mix invoices we bought
-- (earn commission) with shop-sent invoices (delivery fee only), so the flag
-- now lives on each invoice row.
--
-- This adds retail_goods_invoices.is_procurement. The app snapshots
-- commission_rate / commission_amount (added in fix71) only on invoices whose
-- is_procurement is TRUE. The order-level delivery_orders.is_procurement is kept
-- as a summary (TRUE when any of the order's invoices are marked purchased).
--
-- Backfill: existing invoices inherit their order's old flag, so historical
-- commission attribution is preserved.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE retail_goods_invoices
  ADD COLUMN IF NOT EXISTS is_procurement BOOLEAN DEFAULT FALSE;

-- Backfill from the order-level flag (only where the invoice hasn't been set yet).
UPDATE retail_goods_invoices rgi
   SET is_procurement = TRUE
  FROM delivery_orders o
 WHERE o.id = rgi.order_id
   AND COALESCE(o.is_procurement, FALSE) = TRUE
   AND COALESCE(rgi.is_procurement, FALSE) = FALSE;

-- Belt-and-suspenders: clear any commission left on invoices NOT marked as
-- purchased, so "we only earn commission when we bought" holds for old rows too.
UPDATE retail_goods_invoices
   SET commission_rate = NULL, commission_amount = NULL
 WHERE COALESCE(is_procurement, FALSE) = FALSE
   AND (commission_rate IS NOT NULL OR commission_amount IS NOT NULL);

-- ── Redefine the month-end settlement view (from fix71) ──────────────────────
-- Same shape as fix71, but commission is now gated on the per-invoice
-- is_procurement flag at the DB level: an invoice we did NOT buy contributes
-- ZERO commission no matter what, while purchases / paid / unpaid (what we owe
-- the shop for goods) still count every invoice.
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
  SUM(CASE WHEN rgi.paid THEN rgi.invoice_value ELSE 0 END)            AS paid_total,
  SUM(CASE WHEN rgi.paid THEN 0 ELSE rgi.invoice_value END)            AS unpaid_total
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

-- A view runs with its CREATOR's rights unless told otherwise, which would
-- bypass row-level security for every anon query (Supabase flags that as
-- critical). security_invoker makes it run as the CALLER. See fix122.
ALTER VIEW public.v_supplier_settlements SET (security_invoker = on);
