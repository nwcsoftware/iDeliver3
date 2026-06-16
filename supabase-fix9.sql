-- Fix: allow anon role to insert into audit_logs
-- The audit trigger on delivery_orders fires automatically and writes to audit_logs,
-- but audit_logs has RLS enabled with no anon policy.

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_audit_logs_insert" ON audit_logs;

CREATE POLICY "anon_audit_logs_insert" ON audit_logs FOR INSERT TO anon WITH CHECK (true);
