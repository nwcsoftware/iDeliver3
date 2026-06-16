-- Fix: allow anon role to read/write purchase_invoices and purchase_invoice_items
-- Also adds anon SELECT on contacts so the supplier dropdown works.

-- ── contacts (anon SELECT for lookups) ────────────────────────────────────
DROP POLICY IF EXISTS "anon_contacts_select" ON contacts;
CREATE POLICY "anon_contacts_select" ON contacts FOR SELECT TO anon USING (true);

-- ── purchase_invoices ──────────────────────────────────────────────────────
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_purchase_invoices_select" ON purchase_invoices;
DROP POLICY IF EXISTS "anon_purchase_invoices_insert" ON purchase_invoices;
DROP POLICY IF EXISTS "anon_purchase_invoices_update" ON purchase_invoices;

CREATE POLICY "anon_purchase_invoices_select" ON purchase_invoices FOR SELECT TO anon USING (true);
CREATE POLICY "anon_purchase_invoices_insert" ON purchase_invoices FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_purchase_invoices_update" ON purchase_invoices FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── purchase_invoice_items ─────────────────────────────────────────────────
ALTER TABLE purchase_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_purchase_invoice_items_select" ON purchase_invoice_items;
DROP POLICY IF EXISTS "anon_purchase_invoice_items_insert" ON purchase_invoice_items;
DROP POLICY IF EXISTS "anon_purchase_invoice_items_update" ON purchase_invoice_items;
DROP POLICY IF EXISTS "anon_purchase_invoice_items_delete" ON purchase_invoice_items;

CREATE POLICY "anon_purchase_invoice_items_select" ON purchase_invoice_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon_purchase_invoice_items_insert" ON purchase_invoice_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_purchase_invoice_items_update" ON purchase_invoice_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_purchase_invoice_items_delete" ON purchase_invoice_items FOR DELETE TO anon USING (true);
