-- 0004: a dimension may be left UNASSESSED when the candidate didn't cover it
-- (we mark it rather than inventing a score). Reports also record whether the
-- interview had enough substance to score at all.
ALTER TABLE scores  ADD COLUMN IF NOT EXISTS assessed BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS scored   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS note     TEXT NOT NULL DEFAULT '';
