package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// SessionMetrics contains operational counts only, never private response text
// or provider diagnostics. ErrorCount counts persisted failure episodes; it is
// not inferred from final status (a recovered interview can have errors too).
type SessionMetrics struct {
	ErrorCount      int `json:"error_count"`
	TurnCount       int `json:"turn_count"`
	DurationSeconds int `json:"duration_seconds"`
}

func (s *Store) SessionMetrics(ctx context.Context, id string) (SessionMetrics, error) {
	var metrics SessionMetrics
	err := s.Pool.QueryRow(ctx, `SELECT
 s.runtime_error_count,
 (SELECT count(*) FROM transcript_turns WHERE session_id=s.id),
 CASE WHEN s.started_at IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (LEAST(COALESCE(s.ended_at,now()),COALESCE(s.deadline_at,now()))-s.started_at))))::integer END
 FROM sessions s WHERE s.id=$1`, id).Scan(&metrics.ErrorCount, &metrics.TurnCount, &metrics.DurationSeconds)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return metrics, err
}
