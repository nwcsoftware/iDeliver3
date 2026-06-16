-- Fix: allow anon role to insert and update contacts
-- (SELECT was added in fix6; now adding write access for Suppliers/Customers/Partners pages)

DROP POLICY IF EXISTS "anon_contacts_insert" ON contacts;
DROP POLICY IF EXISTS "anon_contacts_update" ON contacts;

CREATE POLICY "anon_contacts_insert" ON contacts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_contacts_update" ON contacts FOR UPDATE TO anon USING (true) WITH CHECK (true);
