-- Operational counts outlive the short retention of raw diagnostic events.
-- No provider responses, keys, transcript content, or user identifiers are
-- duplicated here; the session remains subject to owner deletion and export.
ALTER TABLE sessions ADD COLUMN runtime_error_count integer NOT NULL DEFAULT 0 CHECK (runtime_error_count >= 0);
UPDATE sessions s SET runtime_error_count=(SELECT count(*) FROM events e WHERE e.session_id=s.id AND e.kind IN ('interview_error','scoring_error'));
