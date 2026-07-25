-- =============================================================================
-- fix87 — Set existing retail_goods_invoices.is_procurement to TRUE
-- -----------------------------------------------------------------------------
-- The per-invoice procurement flag (fix86) now defaults to TRUE both in the DB
-- and in the order form: a local-market retail invoice is treated as "We bought"
-- unless the user flips it to "Shop-sent".
--
-- This backfills the existing data so historical rows match that default —
-- every current invoice is marked is_procurement = TRUE.
--
-- Safe to run multiple times.
-- =============================================================================

update retail_goods_invoices
set is_procurement = true
where is_procurement is distinct from true;

-- Keep the order-level summary flag consistent: an order counts as procurement
-- when any of its invoices is marked purchased.
update delivery_orders o
set is_procurement = true
where exists (
  select 1 from retail_goods_invoices r
  where r.order_id = o.id and r.is_procurement = true
)
and o.is_procurement is distinct from true;
