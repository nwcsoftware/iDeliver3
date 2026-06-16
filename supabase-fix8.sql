-- Fix: allow anon role to read/write order_items and delivery_orders

-- ── delivery_orders (ensure write access for status updates) ──────────────
DROP POLICY IF EXISTS "anon_delivery_orders_insert" ON delivery_orders;
DROP POLICY IF EXISTS "anon_delivery_orders_update" ON delivery_orders;
DROP POLICY IF EXISTS "anon_delivery_orders_select" ON delivery_orders;

CREATE POLICY "anon_delivery_orders_select" ON delivery_orders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_delivery_orders_insert" ON delivery_orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delivery_orders_update" ON delivery_orders FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── order_items ────────────────────────────────────────────────────────────
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_order_items_select" ON order_items;
DROP POLICY IF EXISTS "anon_order_items_insert" ON order_items;
DROP POLICY IF EXISTS "anon_order_items_update" ON order_items;

CREATE POLICY "anon_order_items_select" ON order_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon_order_items_insert" ON order_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_order_items_update" ON order_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
