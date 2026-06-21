-- =============================================================================
-- fix62 — Broadcast messages module (admin → all users popup + unread badge)
-- -----------------------------------------------------------------------------
-- Lets an admin push a message that pops up on top of every signed-in user's
-- screen in real time, with a per-user "mark as read" so the sidebar badge can
-- show each user's own count of unread messages.
--
--   broadcast_messages       — the announcement itself (title/body/priority).
--                              is_active = FALSE recalls it (hidden everywhere).
--   broadcast_message_reads  — one row per (message, user) = that user read it.
--
-- Unread, for a user = active messages with no matching read row.
--
-- dev_anon RLS + realtime, matching the rest of the schema. Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS broadcast_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID REFERENCES companies(id),
  title           VARCHAR(200) NOT NULL,
  body            TEXT NOT NULL,
  priority        VARCHAR(20) NOT NULL DEFAULT 'info',   -- info | warning | critical
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES user_accounts(id),
  created_by_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_message_reads (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES user_accounts(id)     ON DELETE CASCADE,
  read_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_messages_active    ON broadcast_messages (is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_message_reads_user ON broadcast_message_reads (user_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_message_reads_msg  ON broadcast_message_reads (message_id);

-- Permissive dev RLS so the app's anon key can read/write the new tables
-- (same dev_anon_* pattern as the rest of the schema).
ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_broadcast_messages" ON broadcast_messages;
CREATE POLICY "dev_anon_broadcast_messages" ON broadcast_messages
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE broadcast_message_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dev_anon_broadcast_message_reads" ON broadcast_message_reads;
CREATE POLICY "dev_anon_broadcast_message_reads" ON broadcast_message_reads
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Realtime so every signed-in client sees a new message immediately. Guarded so
-- re-running the script doesn't error on "table is already a member".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'broadcast_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE broadcast_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'broadcast_message_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE broadcast_message_reads;
  END IF;
END $$;
