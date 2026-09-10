package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type Session struct {
	FeedbackVersion  string          `json:"feedback_version,omitempty"`
	DurationMinutes  int             `json:"duration_minutes"`
	StartedAt        *time.Time      `json:"started_at,omitempty"`
	DeadlineAt       *time.Time      `json:"deadline_at,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	ReservedUntil    *time.Time      `json:"reserved_until,omitempty"`
	Funding          string          `json:"funding"`
	Provider         string          `json:"provider"`
	Model            string          `json:"model"`
	LiveModel        string          `json:"live_model,omitempty"`
	Mode             string          `json:"mode"`
	QuestionSnapshot json.RawMessage `json:"-"`
	UsageIdentity    string          `json:"-"`
	Workspace        Workspace       `json:"workspace"`
	ID               string          `json:"id"`
	UserID           string          `json:"-"`
	QuestionID       string          `json:"question_id"`
	Modality         string          `json:"modality"`
	Track            string          `json:"track"`
	Status           string          `json:"status"`
	Phase            string          `json:"phase"`
	Config           json.RawMessage `json:"config"`
	PackID           string          `json:"pack_id,omitempty"`
	PackRoundID      string          `json:"pack_round_id,omitempty"`
}

func (s *Store) CreateSession(ctx context.Context, userID, questionID, modality, track, packID, roundID string, cfg json.RawMessage) (Session, error) {
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	sess := Session{
		ID: NewID(), UserID: userID, QuestionID: questionID, Modality: modality,
		Track: track, Status: "created", Phase: "lobby", Config: cfg,
		PackID: packID, PackRoundID: roundID,
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO sessions (id, user_id, question_id, modality, track, config, status, phase, started_at, pack_id, pack_round_id)
		 VALUES ($1,$2,$3,$4,$5,$6,'created','lobby', now(), $7, $8)`,
		sess.ID, userID, questionID, modality, track, cfg, packID, roundID)
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
	ID          string   `json:"id"`
	QuestionID  string   `json:"question_id"`
	Modality    string   `json:"modality"`
	Track       string   `json:"track"`
	Status      string   `json:"status"`
	CreatedAt   string   `json:"created_at"`
	Overall     *float64 `json:"overall,omitempty"`
	Scored      *bool    `json:"scored,omitempty"`
	PackID      string   `json:"pack_id,omitempty"`
	PackRoundID string   `json:"pack_round_id,omitempty"`
}

// ListUserSessions returns the user's past sessions (newest first) with the
// report's overall/scored when available.
func (s *Store) ListUserSessions(ctx context.Context, userID string, limit int) ([]SessionSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT s.id, s.question_id, s.modality, s.track, s.status,
		       to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS'), r.overall, r.scored,
		       s.pack_id, s.pack_round_id
		FROM sessions s LEFT JOIN reports r ON r.session_id = s.id
		WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionSummary
	for rows.Next() {
		var ss SessionSummary
		if err := rows.Scan(&ss.ID, &ss.QuestionID, &ss.Modality, &ss.Track, &ss.Status, &ss.CreatedAt, &ss.Overall, &ss.Scored, &ss.PackID, &ss.PackRoundID); err != nil {
			return nil, err
		}
		out = append(out, ss)
	}
	return out, rows.Err()
}

// SessionsForPack returns the user's sessions that belong to a given pack
// (newest first, with report overall/scored), for per-pack progress.
func (s *Store) SessionsForPack(ctx context.Context, userID, packID string) ([]SessionSummary, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT s.id, s.question_id, s.modality, s.track, s.status,
		       to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS'), r.overall, r.scored,
		       s.pack_id, s.pack_round_id
		FROM sessions s LEFT JOIN reports r ON r.session_id = s.id
		WHERE s.user_id=$1 AND s.pack_id=$2 ORDER BY s.created_at DESC`, userID, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionSummary
	for rows.Next() {
		var ss SessionSummary
		if err := rows.Scan(&ss.ID, &ss.QuestionID, &ss.Modality, &ss.Track, &ss.Status, &ss.CreatedAt, &ss.Overall, &ss.Scored, &ss.PackID, &ss.PackRoundID); err != nil {
			return nil, err
		}
		out = append(out, ss)
	}
	return out, rows.Err()
}

func (s *Store) GetSession(ctx context.Context, id string) (Session, error) {
	return scanSession(s.Pool.QueryRow(ctx, sessionSelect+` WHERE id=$1`, id))
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
	EventID  string `json:"event_id,omitempty"`
	ID       string `json:"id,omitempty"`
	Sequence int64  `json:"sequence,omitempty"`
	Role     string `json:"role"`
	Text     string `json:"text"`
	TsMs     int64  `json:"ts_ms"`
}

func (s *Store) AddTurn(ctx context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error {
	if len(meta) == 0 {
		meta = json.RawMessage(`{}`)
	}
	var m struct {
		EventID string `json:"event_id"`
	}
	_ = json.Unmarshal(meta, &m)
	tag, err := s.Pool.Exec(ctx, `INSERT INTO transcript_turns(id,session_id,role,text,ts_ms,meta,event_id)
 SELECT $1,id,$3,$4,GREATEST(0,extract(epoch FROM (now()-COALESCE(started_at,created_at)))*1000)::bigint,$5,NULLIF($6,'') FROM sessions WHERE id=$2 AND status IN ('created','reserved','active','interrupted','ending') AND (NULLIF($5::jsonb->>'lease_owner','') IS NULL OR lease_owner=$5::jsonb->>'lease_owner' AND lease_until>now())
 ON CONFLICT(session_id,event_id) WHERE event_id IS NOT NULL DO NOTHING`, NewID(), sessionID, role, text, meta, m.EventID)
	if err == nil && tag.RowsAffected() == 0 {
		if m.EventID != "" {
			var exists bool
			e := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM transcript_turns WHERE session_id=$1 AND event_id=$2)`, sessionID, m.EventID).Scan(&exists)
			if e != nil {
				return e
			}
			if exists {
				return ErrDuplicateEvent
			}
		}
		return ErrSessionConflict
	}
	return err
}

func (s *Store) Transcript(ctx context.Context, sessionID string) ([]Turn, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT id, sequence, role, text, ts_ms, COALESCE(event_id,'') FROM transcript_turns WHERE session_id=$1 ORDER BY sequence ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Turn
	for rows.Next() {
		var t Turn
		if err := rows.Scan(&t.ID, &t.Sequence, &t.Role, &t.Text, &t.TsMs, &t.EventID); err != nil {
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
		`SELECT content FROM workspace_snapshots WHERE session_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, sessionID).Scan(&content)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return content, err
}

// LatestCanvasDescription returns a text description of the latest canvas, if any.
func (s *Store) LatestCanvasElements(ctx context.Context, sessionID string) (json.RawMessage, error) {
	var elements json.RawMessage
	err := s.Pool.QueryRow(ctx,
		`SELECT elements FROM canvas_snapshots WHERE session_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, sessionID).Scan(&elements)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return elements, err
}
