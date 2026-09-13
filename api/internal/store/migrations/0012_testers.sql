-- Operator-managed allowlist can precede registration; only verified accounts
-- with matching email receive tester access. Membership does not grant a role.
CREATE TABLE tester_emails (
 email text PRIMARY KEY CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Keep tester starts in the personal ledger so removing access restores rolling
-- limits, while their testing does not consume ordinary users' global budget.
ALTER TABLE interview_usage ADD COLUMN tester_exempt boolean NOT NULL DEFAULT false;
