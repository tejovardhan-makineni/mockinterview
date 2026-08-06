-- 0001_init: core schema for the mock system-design interview platform.
-- Postgres 16+. UUIDv7 ids are generated in Go (see store/ids.go) so no DB
-- extension is required.

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resumes (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    storage_ref TEXT NOT NULL DEFAULT '',
    parsed_text TEXT NOT NULL DEFAULT '',
    parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes(user_id, created_at DESC);

-- One configurable interviewer setup per user (voice, face, persona).
CREATE TABLE IF NOT EXISTS interview_configs (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    voice_id    TEXT NOT NULL DEFAULT 'aoede',
    face_id     TEXT NOT NULL DEFAULT 'ava',
    personality TEXT NOT NULL DEFAULT 'neutral',  -- supportive|neutral|interruptive|annoying
    intensity   INT  NOT NULL DEFAULT 3,          -- 1..5
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT intensity_range CHECK (intensity BETWEEN 1 AND 5),
    CONSTRAINT personality_valid CHECK (personality IN ('supportive','neutral','interruptive','annoying'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status      TEXT NOT NULL DEFAULT 'created', -- created|active|scoring|complete|abandoned
    phase       TEXT NOT NULL DEFAULT 'lobby',
    started_at  TIMESTAMPTZ,
    ended_at    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcript_turns (
    id         UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,          -- interviewer|candidate|system
    text       TEXT NOT NULL,
    ts_ms      BIGINT NOT NULL,        -- ms since session start
    meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transcript_session_idx ON transcript_turns(session_id, ts_ms);

CREATE TABLE IF NOT EXISTS canvas_snapshots (
    id         UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms      BIGINT NOT NULL,
    elements   JSONB NOT NULL DEFAULT '[]'::jsonb,
    image_ref  TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS canvas_session_idx ON canvas_snapshots(session_id, ts_ms);

-- Raw behavioral telemetry sampled client-side (MediaPipe + VAD). Aggregated
-- later into presence/communication scores.
CREATE TABLE IF NOT EXISTS behavior_samples (
    id         UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms      BIGINT NOT NULL,
    gaze       JSONB NOT NULL DEFAULT '{}'::jsonb,
    head_pose  JSONB NOT NULL DEFAULT '{}'::jsonb,
    expression JSONB NOT NULL DEFAULT '{}'::jsonb,
    posture    JSONB NOT NULL DEFAULT '{}'::jsonb,
    lighting   JSONB NOT NULL DEFAULT '{}'::jsonb,
    vad        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS behavior_session_idx ON behavior_samples(session_id, ts_ms);

-- Discrete behavioral events (filler words, long pauses, help requests, interruptions).
CREATE TABLE IF NOT EXISTS events (
    id         UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms      BIGINT NOT NULL,
    kind       TEXT NOT NULL,   -- filler|long_pause|help_request|interruption
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id, ts_ms);

CREATE TABLE IF NOT EXISTS scores (
    id           UUID PRIMARY KEY,
    session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    dimension    TEXT NOT NULL,
    phase        TEXT NOT NULL DEFAULT 'overall',
    score        REAL NOT NULL,          -- 0..4
    weight       REAL NOT NULL DEFAULT 1,
    evidence     TEXT NOT NULL DEFAULT '',
    expected     TEXT NOT NULL DEFAULT '',
    actual       TEXT NOT NULL DEFAULT '',
    coverage_pct INT  NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scores_session_idx ON scores(session_id);

CREATE TABLE IF NOT EXISTS reports (
    id         UUID PRIMARY KEY,
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    overall    REAL NOT NULL DEFAULT 0,
    radar      JSONB NOT NULL DEFAULT '{}'::jsonb,
    timeline   JSONB NOT NULL DEFAULT '[]'::jsonb,
    behavioral JSONB NOT NULL DEFAULT '{}'::jsonb,
    coaching_md TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
