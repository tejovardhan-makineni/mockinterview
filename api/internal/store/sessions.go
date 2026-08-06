package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

type Session struct {
	ID         string          `json:"id"`
	UserID     string          `json:"-"`
	QuestionID string          `json:"question_id"`
	Modality   string          `json:"modality"`
	Track      string          `json:"track"`
	Status     string          `json:"status"`
	Phase      string          `json:"phase"`
	Config     json.RawMessage `json:"config"`
}

func (s *Store) CreateSession(ctx context.Context, userID, questionID, modality, track string, cfg json.RawMessage) (Session, error) {
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	sess := Session{
		ID: NewID(), UserID: userID, QuestionID: questionID, Modality: modality,
		Track: track, Status: "created", Phase: "lobby", Config: cfg,
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO sessions (id, user_id, question_id, modality, track, config, status, phase, started_at)
		 VALUES ($1,$2,$3,$4,$5,$6,'created','lobby', now())`,
		sess.ID, userID, questionID, modality, track, cfg)
	return sess, err
}

// CountSessionsToday counts sessions the user created since midnight (server tz).
func (s *Store) CountSessionsToday(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM sessions WHERE user_id=$1 AND created_at >= date_trunc('day', now())`, userID).Scan(&n)
	return n, err
}

type SessionSummary struct {
	ID         string   `json:"id"`
	QuestionID string   `json:"question_id"`
	Modality   string   `json:"modality"`
	Track      string   `json:"track"`
	Status     string   `json:"status"`
	CreatedAt  string   `json:"created_at"`
	Overall    *float64 `json:"overall,omitempty"`
	Scored     *bool    `json:"scored,omitempty"`
}

// ListUserSessions returns the user's past sessions (newest first) with the
// report's overall/scored when available.
func (s *Store) ListUserSessions(ctx context.Context, userID string, limit int) ([]SessionSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT s.id, s.question_id, s.modality, s.track, s.status,
		       to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS'), r.overall, r.scored
		FROM sessions s LEFT JOIN reports r ON r.session_id = s.id
		WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionSummary
	for rows.Next() {
		var ss SessionSummary
		if err := rows.Scan(&ss.ID, &ss.QuestionID, &ss.Modality, &ss.Track, &ss.Status, &ss.CreatedAt, &ss.Overall, &ss.Scored); err != nil {
			return nil, err
		}
		out = append(out, ss)
	}
	return out, rows.Err()
}

func (s *Store) GetSession(ctx context.Context, id string) (Session, error) {
	var sess Session
	err := s.Pool.QueryRow(ctx,
		`SELECT id, user_id, question_id, modality, track, status, phase, config FROM sessions WHERE id=$1`, id).
		Scan(&sess.ID, &sess.UserID, &sess.QuestionID, &sess.Modality, &sess.Track, &sess.Status, &sess.Phase, &sess.Config)
	if errors.Is(err, pgx.ErrNoRows) {
		return sess, ErrNotFound
	}
	return sess, err
}

func (s *Store) UpdateSessionPhase(ctx context.Context, id, phase string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE sessions SET phase=$2 WHERE id=$1`, id, phase)
	return err
}

func (s *Store) UpdateSessionStatus(ctx context.Context, id, status string) error {
	q := `UPDATE sessions SET status=$2 WHERE id=$1`
	if status == "complete" || status == "abandoned" {
		q = `UPDATE sessions SET status=$2, ended_at=now() WHERE id=$1`
	}
	_, err := s.Pool.Exec(ctx, q, id, status)
	return err
}

// ---- transcript ----

type Turn struct {
	Role string `json:"role"`
	Text string `json:"text"`
	TsMs int64  `json:"ts_ms"`
}

func (s *Store) AddTurn(ctx context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error {
	if len(meta) == 0 {
		meta = json.RawMessage(`{}`)
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO transcript_turns (id, session_id, role, text, ts_ms, meta) VALUES ($1,$2,$3,$4,$5,$6)`,
		NewID(), sessionID, role, text, tsMs, meta)
	return err
}

func (s *Store) Transcript(ctx context.Context, sessionID string) ([]Turn, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT role, text, ts_ms FROM transcript_turns WHERE session_id=$1 ORDER BY ts_ms ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Turn
	for rows.Next() {
		var t Turn
		if err := rows.Scan(&t.Role, &t.Text, &t.TsMs); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ---- workspace / canvas snapshots ----

func (s *Store) AddCanvasSnapshot(ctx context.Context, sessionID string, tsMs int64, elements json.RawMessage, imageRef string) error {
	if len(elements) == 0 {
		elements = json.RawMessage(`[]`)
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO canvas_snapshots (id, session_id, ts_ms, elements, image_ref) VALUES ($1,$2,$3,$4,$5)`,
		NewID(), sessionID, tsMs, elements, imageRef)
	return err
}

func (s *Store) AddWorkspaceSnapshot(ctx context.Context, sessionID string, tsMs int64, kind, content string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO workspace_snapshots (id, session_id, ts_ms, kind, content) VALUES ($1,$2,$3,$4,$5)`,
		NewID(), sessionID, tsMs, kind, content)
	return err
}

// LatestWorkspace returns the most recent workspace content for a session (the
// final code/written artifact), used by the scorer.
func (s *Store) LatestWorkspace(ctx context.Context, sessionID string) (string, error) {
	var content string
	err := s.Pool.QueryRow(ctx,
		`SELECT content FROM workspace_snapshots WHERE session_id=$1 ORDER BY ts_ms DESC LIMIT 1`, sessionID).Scan(&content)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return content, err
}

// LatestCanvasDescription returns a text description of the latest canvas, if any.
func (s *Store) LatestCanvasElements(ctx context.Context, sessionID string) (json.RawMessage, error) {
	var elements json.RawMessage
	err := s.Pool.QueryRow(ctx,
		`SELECT elements FROM canvas_snapshots WHERE session_id=$1 ORDER BY ts_ms DESC LIMIT 1`, sessionID).Scan(&elements)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return elements, err
}
