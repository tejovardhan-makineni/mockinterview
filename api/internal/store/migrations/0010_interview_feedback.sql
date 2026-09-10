-- Legacy attempts remain exempt. Only the new creation path stamps a version.
ALTER TABLE sessions ADD COLUMN feedback_version TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD CONSTRAINT sessions_id_user_unique UNIQUE (id,user_id);
CREATE TABLE interview_feedback (
 session_id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version TEXT NOT NULL CHECK (version <> ''),
 answers JSONB NOT NULL CHECK (jsonb_typeof(answers)='object'),
 comment TEXT NOT NULL DEFAULT '' CHECK (char_length(comment)<=2000),
 share_transcript BOOLEAN NOT NULL DEFAULT false,
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(session_id,user_id) REFERENCES sessions(id,user_id) ON DELETE CASCADE
);
CREATE INDEX interview_feedback_user_idx ON interview_feedback(user_id);
CREATE INDEX sessions_feedback_eligible_idx ON sessions(user_id,started_at) WHERE feedback_version<>'' AND started_at IS NOT NULL;
CREATE INDEX sessions_feedback_window_idx ON sessions(started_at) WHERE feedback_version<>'' AND started_at IS NOT NULL;
CREATE INDEX interview_feedback_comments_idx ON interview_feedback(updated_at DESC,session_id DESC) WHERE comment<>'';
