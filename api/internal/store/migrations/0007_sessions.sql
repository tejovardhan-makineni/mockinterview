-- Durable attempts, ordered transcripts, atomic hosted usage and expiring BYOK.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 30;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reserved_until timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS funding text NOT NULL DEFAULT 'platform';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'voice';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS question_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE transcript_turns ADD COLUMN IF NOT EXISTS sequence bigserial;
-- Backfill stable historical order rather than the heap order used by ADD bigserial.
WITH ordered AS (SELECT id,row_number() OVER (ORDER BY created_at,id) AS position FROM transcript_turns)
UPDATE transcript_turns t SET sequence=ordered.position FROM ordered WHERE t.id=ordered.id;
SELECT setval(pg_get_serial_sequence('transcript_turns','sequence'),COALESCE((SELECT max(sequence) FROM transcript_turns),1),EXISTS(SELECT 1 FROM transcript_turns));
ALTER TABLE transcript_turns ADD COLUMN IF NOT EXISTS event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS transcript_event_unique ON transcript_turns(session_id,event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transcript_sequence_idx ON transcript_turns(session_id,sequence);
ALTER TABLE workspace_snapshots ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
ALTER TABLE workspace_snapshots ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS session_credentials (
 session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 ciphertext bytea NOT NULL, expires_at timestamptz NOT NULL
);
-- No user/session FK: deleting private history must not reset the rolling quota.
-- identity is a server HMAC of verified email, never the email itself.
CREATE TABLE IF NOT EXISTS interview_usage (
 session_id uuid PRIMARY KEY, identity text NOT NULL, funding text NOT NULL,
 activated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS interview_usage_identity ON interview_usage(identity,activated_at DESC);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS usage_identity text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS scoring_jobs (
 session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, not_before timestamptz NOT NULL DEFAULT now(), input jsonb, error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS quota_exempt boolean NOT NULL DEFAULT false;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS global_daily_limit integer NOT NULL DEFAULT 0;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS live_model text NOT NULL DEFAULT '';

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','planned','resolved'));

-- Historical attempts had no enforced server deadline. Retain every record and
-- report, but do not reopen or automatically score an overdue legacy attempt.
UPDATE sessions SET deadline_at=COALESCE(started_at,created_at)+make_interval(mins=>duration_minutes)
 WHERE deadline_at IS NULL AND question_snapshot='{}';
UPDATE sessions SET status='expired',ended_at=COALESCE(ended_at,deadline_at)
 WHERE status IN ('created','active','interrupted') AND deadline_at<now() AND question_snapshot='{}';
