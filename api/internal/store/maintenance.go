package store

import (
	"context"
	"log/slog"
	"time"
)

// Maintenance enforces documented short-lived data retention on startup and
// hourly. This portable worker requires CPU allocation while idle in Cloud Run.
func (s *Store) Maintenance(ctx context.Context) {
	run := func() {
		work, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if _, err := s.PurgeBehaviorSamplesOlderThan(work, BehaviorRetention); err != nil {
			slog.Error("retention_failed", "table", "behavior")
			return
		}
		for _, stmt := range []string{
			`DELETE FROM auth_actions WHERE expires_at<now()`,
			`DELETE FROM session_credentials WHERE expires_at<now() OR session_id IN (SELECT id FROM sessions WHERE status IN ('complete','abandoned','failed'))`,
			`DELETE FROM interview_usage WHERE activated_at<now()-interval '7 days'`,
			`UPDATE sessions SET status='abandoned' WHERE status IN ('created','reserved') AND COALESCE(reserved_until,created_at+interval '10 minutes')<now()`,
		} {
			if _, err := s.Pool.Exec(work, stmt); err != nil {
				slog.Error("retention_failed", "table", "ephemeral")
				return
			}
		}
		slog.Info("retention_completed")
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
