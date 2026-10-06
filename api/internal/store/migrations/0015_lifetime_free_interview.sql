-- Minimal allowance marker: no account/session FK or interview content. It
-- deliberately survives private history/account deletion and usage retention.
CREATE TABLE free_interview_claims (
 identity TEXT PRIMARY KEY,
 claimed_at TIMESTAMPTZ NOT NULL
);
INSERT INTO free_interview_claims(identity,claimed_at)
SELECT identity,min(activated_at) FROM interview_usage WHERE funding='platform' AND identity<>'' GROUP BY identity
ON CONFLICT DO NOTHING;
-- The old usage ledger was retained for seven days. Recover older claims when
-- the original session is still available; previously erased records cannot be recovered.
INSERT INTO free_interview_claims(identity,claimed_at)
SELECT usage_identity,min(started_at) FROM sessions WHERE funding='platform' AND NOT quota_exempt AND started_at IS NOT NULL AND usage_identity<>'' GROUP BY usage_identity
ON CONFLICT DO NOTHING;
