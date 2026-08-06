package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

type ScoreRow struct {
	Dimension   string  `json:"dimension"`
	Phase       string  `json:"phase"`
	Score       float64 `json:"score"`
	Weight      float64 `json:"weight"`
	Evidence    string  `json:"evidence"`
	Expected    string  `json:"expected"`
	Actual      string  `json:"actual"`
	CoveragePct int     `json:"coverage_pct"`
	Assessed    bool    `json:"assessed"`
}

func (s *Store) SaveScores(ctx context.Context, sessionID string, rows []ScoreRow) error {
	batch := &pgx.Batch{}
	// Replace any prior scores for idempotent re-scoring.
	batch.Queue(`DELETE FROM scores WHERE session_id=$1`, sessionID)
	for _, r := range rows {
		batch.Queue(
			`INSERT INTO scores (id, session_id, dimension, phase, score, weight, evidence, expected, actual, coverage_pct, assessed)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			NewID(), sessionID, r.Dimension, r.Phase, r.Score, r.Weight, r.Evidence, r.Expected, r.Actual, r.CoveragePct, r.Assessed)
	}
	br := s.Pool.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) SaveReport(ctx context.Context, sessionID string, overall float64, radar, timeline, behavioral json.RawMessage, coachingMD string, scored bool, note string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO reports (id, session_id, overall, radar, timeline, behavioral, coaching_md, scored, note)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (session_id) DO UPDATE SET
		   overall=EXCLUDED.overall, radar=EXCLUDED.radar, timeline=EXCLUDED.timeline,
		   behavioral=EXCLUDED.behavioral, coaching_md=EXCLUDED.coaching_md, scored=EXCLUDED.scored, note=EXCLUDED.note`,
		NewID(), sessionID, overall, radar, timeline, behavioral, coachingMD, scored, note)
	return err
}

type Report struct {
	Overall    float64         `json:"overall"`
	Radar      json.RawMessage `json:"radar"`
	Timeline   json.RawMessage `json:"timeline"`
	Behavioral json.RawMessage `json:"behavioral"`
	CoachingMD string          `json:"coaching_md"`
	Scored     bool            `json:"scored"`
	Note       string          `json:"note"`
}

func (s *Store) GetReport(ctx context.Context, sessionID string) (Report, []ScoreRow, error) {
	var r Report
	err := s.Pool.QueryRow(ctx,
		`SELECT overall, radar, timeline, behavioral, coaching_md, scored, note FROM reports WHERE session_id=$1`, sessionID).
		Scan(&r.Overall, &r.Radar, &r.Timeline, &r.Behavioral, &r.CoachingMD, &r.Scored, &r.Note)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, nil, ErrNotFound
	}
	if err != nil {
		return r, nil, err
	}
	rows, err := s.Pool.Query(ctx,
		`SELECT dimension, phase, score, weight, evidence, expected, actual, coverage_pct, assessed FROM scores WHERE session_id=$1`, sessionID)
	if err != nil {
		return r, nil, err
	}
	defer rows.Close()
	var scores []ScoreRow
	for rows.Next() {
		var sr ScoreRow
		if err := rows.Scan(&sr.Dimension, &sr.Phase, &sr.Score, &sr.Weight, &sr.Evidence, &sr.Expected, &sr.Actual, &sr.CoveragePct, &sr.Assessed); err != nil {
			return r, nil, err
		}
		scores = append(scores, sr)
	}
	return r, scores, rows.Err()
}
