package memstore

import (
	"context"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func (m *Mem) SessionMetrics(_ context.Context, id string) (store.SessionMetrics, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return store.SessionMetrics{}, store.ErrNotFound
	}
	metrics := store.SessionMetrics{TurnCount: len(v.turns)}
	for _, event := range v.events {
		if event == "interview_error" || event == "scoring_error" {
			metrics.ErrorCount++
		}
	}
	if v.sess.StartedAt != nil {
		end := time.Now()
		if v.endedAt != nil {
			end = *v.endedAt
		}
		if v.sess.DeadlineAt != nil && v.sess.DeadlineAt.Before(end) {
			end = *v.sess.DeadlineAt
		}
		metrics.DurationSeconds = max(0, int(end.Sub(*v.sess.StartedAt).Seconds()))
	}
	return metrics, nil
}
