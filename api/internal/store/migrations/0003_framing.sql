-- 0003: framing signal (how well the candidate's face is centered/sized in
-- frame) is captured separately from posture.
ALTER TABLE behavior_samples ADD COLUMN IF NOT EXISTS framing JSONB NOT NULL DEFAULT '{}'::jsonb;
