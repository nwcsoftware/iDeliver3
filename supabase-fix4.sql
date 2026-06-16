-- Fix: allow anon role to read/write companies and branches
-- The app uses a custom auth system (verify_login RPC) and always runs as the
-- anon role, so these tables need permissive policies for all operations.

-- ── companies ──────────────────────────────────────────────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_companies_select" ON companies;
DROP POLICY IF EXISTS "anon_companies_insert" ON companies;
DROP POLICY IF EXISTS "anon_companies_update" ON companies;

CREATE POLICY "anon_companies_select" ON companies FOR SELECT TO anon USING (true);
CREATE POLICY "anon_companies_insert" ON companies FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_companies_update" ON companies FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── branches ───────────────────────────────────────────────────────────────
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_branches_select" ON branches;
DROP POLICY IF EXISTS "anon_branches_insert" ON branches;
DROP POLICY IF EXISTS "anon_branches_update" ON branches;

CREATE POLICY "anon_branches_select" ON branches FOR SELECT TO anon USING (true);
CREATE POLICY "anon_branches_insert" ON branches FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_branches_update" ON branches FOR UPDATE TO anon USING (true) WITH CHECK (true);
