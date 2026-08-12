-- 0005: a session may belong to a company/goal "pack" round (practice packs —
-- e.g. an Amazon loop). Both default to '' so all existing sessions are simply
-- "not part of a pack". Indexed by (user, pack) for per-pack progress lookups.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pack_id       TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pack_round_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sessions_user_pack ON sessions (user_id, pack_id);
