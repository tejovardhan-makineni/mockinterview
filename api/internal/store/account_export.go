package store

import (
	"context"
	"encoding/json"
)

// ExportAccount intentionally excludes password hashes, auth actions, access
// tokens, encrypted provider credentials and the pseudonymous quota ledger.
func (s *Store) ExportAccount(ctx context.Context, uid string) (json.RawMessage, error) {
	var data json.RawMessage
	err := s.Pool.QueryRow(ctx, `SELECT jsonb_build_object(
 'export_version',1,'exported_at',now(),
 'account',(SELECT to_jsonb(u)-'password_hash'-'token_version' FROM users u WHERE id=$1),
 'settings',(SELECT settings FROM users WHERE id=$1),
 'interviewer_config',(SELECT to_jsonb(c)-'user_id' FROM interview_configs c WHERE user_id=$1),
 'resumes',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM resumes r WHERE user_id=$1),'[]'::jsonb),
 'resume_reviews',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM resume_reviews r WHERE user_id=$1),'[]'::jsonb),
 'canvas',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM canvas_snapshots c JOIN sessions s ON s.id=c.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)-'question_snapshot'-'usage_identity'-'lease_owner'-'lease_until'-'quota_exempt'-'global_daily_limit') FROM sessions s WHERE user_id=$1),'[]'::jsonb),
 'transcript',COALESCE((SELECT jsonb_agg(jsonb_set(to_jsonb(t),'{meta}',COALESCE(t.meta,'{}'::jsonb)-'lease_owner')) FROM transcript_turns t JOIN sessions s ON s.id=t.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'workspace',COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM workspace_snapshots w JOIN sessions s ON s.id=w.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'behavior_samples',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM behavior_samples b JOIN sessions s ON s.id=b.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM events e JOIN sessions s ON s.id=e.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'reports',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM reports r JOIN sessions s ON s.id=r.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'scores',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM scores r JOIN sessions s ON s.id=r.session_id WHERE s.user_id=$1),'[]'::jsonb),
 'feedback',COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM feedback f WHERE user_id=$1),'[]'::jsonb)
 )`, uid).Scan(&data)
	return data, err
}
