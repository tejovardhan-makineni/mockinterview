CREATE TABLE free_interview_claims (identity TEXT PRIMARY KEY, claimed_at INTEGER NOT NULL);
INSERT INTO free_interview_claims(identity,claimed_at)
SELECT identity,min(activated_at) FROM interview_usage WHERE funding='platform' AND identity<>'' GROUP BY identity;
INSERT OR IGNORE INTO free_interview_claims(identity,claimed_at)
SELECT json_extract(data,'$.UsageIdentity'),min(CAST(unixepoch(json_extract(data,'$.Session.started_at')) * 1000 AS INTEGER))
FROM sessions WHERE json_extract(data,'$.Session.funding')='platform'
AND json_extract(data,'$.QuotaExempt')=0 AND json_extract(data,'$.Session.started_at') IS NOT NULL
AND json_extract(data,'$.UsageIdentity')<>'' GROUP BY json_extract(data,'$.UsageIdentity');
