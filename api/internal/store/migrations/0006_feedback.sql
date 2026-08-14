-- 0006: user feedback (general, or captured DURING an interview). `context`
-- holds page + session + interview debug details as JSON so a reported problem
-- can be reproduced. Cascade-deletes with the user (account deletion erases it).
CREATE TABLE IF NOT EXISTS feedback (
    id         UUID PRIMARY KEY,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'general',   -- general | interview
    message    TEXT NOT NULL,
    rating     INT  NOT NULL DEFAULT 0,           -- 0 = unset, else 1..5
    context    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at DESC);
