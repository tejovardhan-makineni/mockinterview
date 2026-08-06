-- 0002: generalize sessions to any interview modality/track, and add a table
-- for standalone resume reviews (separate from interview scoring).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'system_design';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS track    TEXT NOT NULL DEFAULT 'engineering';

-- Free-form per-modality workspace content captured over the session
-- (code buffers, written docs). Canvas has its own table; this covers the rest.
CREATE TABLE IF NOT EXISTS workspace_snapshots (
    id         UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms      BIGINT NOT NULL,
    kind       TEXT NOT NULL,            -- code|written|note
    content    TEXT NOT NULL DEFAULT '',
    meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_session_idx ON workspace_snapshots(session_id, ts_ms);

CREATE TABLE IF NOT EXISTS resume_reviews (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_id  UUID REFERENCES resumes(id) ON DELETE SET NULL,
    provider   TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL DEFAULT '',
    result     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resume_reviews_user_idx ON resume_reviews(user_id, created_at DESC);
