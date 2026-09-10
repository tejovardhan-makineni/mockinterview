-- Existing accounts are deliberately left unacknowledged. Email verification
-- and previous use do not imply an adult assertion or agreement to a new policy.
ALTER TABLE users ADD COLUMN adult_confirmed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN terms_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN privacy_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN policies_accepted_at TIMESTAMPTZ;
