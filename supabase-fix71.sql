-- =============================================================================
-- fix71: procurement flag + supplier commission tracking + month-end settlement
--
-- Delivery jobs fall into distinct revenue models:
--   • Procurement order  — the customer asks us to buy goods from a shop; WE
--     purchase them and earn a month-end commission (the shop's agreed %),
--     on top of the delivery fee.
--   • Shop-sent order    — the shop sends the delivery through us; we earn the
--     delivery fee only (no commission).
--   • Credit shop        — a shop we settle at month-end: unpaid retail invoices
--     accumulate as a balance we owe them.
--
-- This adds:
--   • delivery_orders.is_procurement           — "we purchased the goods".
--   • retail_goods_invoices.commission_rate    — snapshot of the shop's % ...
--   • retail_goods_invoices.commission_amount  — ... and the money we earn on it.
--     (Snapshotted at save so later rate changes don't rewrite history.)
--   • v_supplier_settlements                   — per shop, per month, per currency:
--     purchases, commission earned, paid, and unpaid balance we owe.
--
-- Commission is only ever recorded on procurement orders (see the app's save
-- logic); shop-sent orders leave commission NULL/0.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS is_procurement BOOLEAN DEFAULT FALSE;

ALTER TABLE retail_goods_invoices
  ADD COLUMN IF NOT EXISTS commission_rate   DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(15,2);

-- ── Month-end settlement per shop ────────────────────────────────────────────
-- One row per (shop, month, currency). "month" is the invoice month (falls back
-- to the order's creation month). Only invoices linked to a shop contact count.
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
  SUM(COALESCE(rgi.commission_amount, 0))                              AS commission_total,
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
