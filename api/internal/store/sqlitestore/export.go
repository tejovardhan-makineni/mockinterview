package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/tejo/mockinterview-api/internal/store"
	"log/slog"
	"time"
)

// ExportAccount is a consistent read of user-owned content. It omits password
// hashes, login actions, lease tokens, provider credentials and quota identities.
func (s *Store) ExportAccount(ctx context.Context, uid string) (raw json.RawMessage, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		u, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, uid)
		if e != nil {
			return e
		}
		settings, e := readJSON[json.RawMessage](ctx, tx, `SELECT settings FROM users WHERE id=?`, uid)
		if e != nil {
			return e
		}
		config, e := readJSON[store.InterviewConfig](ctx, tx, `SELECT data FROM interview_configs WHERE user_id=?`, uid)
		if errors.Is(e, store.ErrNotFound) {
			config = store.DefaultConfig()
		} else if e != nil {
			return e
		}
		docs, e := readSessions(ctx, tx, `WHERE user_id=? ORDER BY created_at,id`, uid)
		if e != nil {
			return e
		}
		sessions := []store.Session{}
		for _, d := range docs {
			sessions = append(sessions, d.Session)
		}
		out := map[string]any{"export_version": 1, "exported_at": time.Now().UTC(), "account": map[string]any{"id": u.ID, "email": u.Email, "role": u.Role, "email_verified": u.EmailVerified, "adult_confirmed_at": u.AdultConfirmedAt, "terms_version": u.TermsVersion, "privacy_version": u.PrivacyVersion, "policies_accepted_at": u.PoliciesAcceptedAt}, "settings": settings, "interviewer_config": config, "sessions": sessions}
		for _, spec := range []struct{ name, query string }{
			{"resumes", `SELECT json_object('id',id,'filename',json_extract(data,'$.Resume.filename'),'parsed_text',json_extract(data,'$.ParsedText'),'parsed',json_extract(data,'$.Resume.parsed')) FROM resumes WHERE user_id=?`},
			{"resume_reviews", `SELECT json_object('id',id,'resume_id',resume_id,'provider',provider,'model',model,'result',json(result),'created_at',created_at) FROM resume_reviews WHERE user_id=?`},
			{"transcript", `SELECT json_set(t.data,'$.session_id',t.session_id,'$.sequence',t.sequence) FROM transcript_turns t JOIN sessions s ON s.id=t.session_id WHERE s.user_id=? ORDER BY t.sequence`},
			{"workspace", `SELECT json_set(w.data,'$.session_id',w.session_id) FROM workspace_snapshots w JOIN sessions s ON s.id=w.session_id WHERE s.user_id=? ORDER BY w.sequence`},
			{"canvas", `SELECT json_object('session_id',c.session_id,'ts_ms',c.ts_ms,'elements',json(c.elements),'image_ref',c.image_ref) FROM canvas_snapshots c JOIN sessions s ON s.id=c.session_id WHERE s.user_id=? ORDER BY c.sequence`},
			{"behavior_samples", `SELECT json_set(b.data,'$.session_id',b.session_id,'$.ts_ms',b.ts_ms) FROM behavior_samples b JOIN sessions s ON s.id=b.session_id WHERE s.user_id=? ORDER BY b.sequence`},
			{"events", `SELECT json_object('session_id',e.session_id,'ts_ms',e.ts_ms,'kind',e.kind,'data',json(e.data)) FROM events e JOIN sessions s ON s.id=e.session_id WHERE s.user_id=? ORDER BY e.sequence`},
			{"reports", `SELECT json_set(r.data,'$.session_id',r.session_id) FROM reports r JOIN sessions s ON s.id=r.session_id WHERE s.user_id=?`},
			{"scores", `SELECT json_object('session_id',r.session_id,'dimensions',json(r.data)) FROM scores r JOIN sessions s ON s.id=r.session_id WHERE s.user_id=?`},
			{"interview_feedback", `SELECT data FROM interview_feedback WHERE user_id=?`},
			{"beta_applications", `SELECT data FROM beta_applications WHERE user_id=?`},
			{"template_requests", `SELECT data FROM template_requests WHERE user_id=?`},
			{"shared_interview_results", `SELECT data FROM shared_interview_results WHERE user_id=?`},
			{"feedback", `SELECT data FROM feedback WHERE user_id=?`},
		} {
			items, e := listJSON[json.RawMessage](ctx, tx, spec.query, uid)
			if e != nil {
				return e
			}
			out[spec.name] = items
		}
		raw, e = json.Marshal(out)
		return e
	})
	return
}

// Maintenance applies the same short-lived raw telemetry policy as hosted mode.
// Durable interview content, workspace and scored reports are never aged out.
func (s *Store) Maintenance(ctx context.Context) {
	run := func() {
		work, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if e := s.maintain(work); e != nil {
			slog.Error("local_retention_failed")
		}
	}
	run()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
func (s *Store) maintain(ctx context.Context) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		for _, spec := range []struct {
			query  string
			cutoff int64
		}{
			{`DELETE FROM behavior_samples WHERE created_at<?`, now.Add(-store.BehaviorRetention).UnixMilli()},
			{`DELETE FROM events WHERE created_at<?`, now.Add(-store.BehaviorRetention).UnixMilli()},
			{`DELETE FROM auth_actions WHERE expires_at<?`, now.UnixMilli()},
			{`DELETE FROM session_credentials WHERE expires_at<? OR session_id IN (SELECT id FROM sessions WHERE status IN ('complete','abandoned','expired','failed'))`, now.UnixMilli()},
			{`DELETE FROM interview_usage WHERE activated_at<?`, now.Add(-7 * 24 * time.Hour).UnixMilli()},
		} {
			if _, e := tx.ExecContext(ctx, spec.query, spec.cutoff); e != nil {
				return e
			}
		}
		docs, e := readSessions(ctx, tx, `WHERE status IN ('preparing','created','reserved')`)
		if e != nil {
			return e
		}
		for _, d := range docs {
			until := d.Session.CreatedAt.Add(10 * time.Minute)
			if d.Session.ReservedUntil != nil {
				until = *d.Session.ReservedUntil
			}
			if until.Before(now) {
				d.Session.Status = "abandoned"
				d.EndedAt = &now
				if e = saveSession(ctx, tx, d); e != nil {
					return e
				}
				if _, e = tx.ExecContext(ctx, `DELETE FROM session_credentials WHERE session_id=?`, d.Session.ID); e != nil {
					return e
				}
			}
		}
		return nil
	})
}
