package store

import (
	"context"
	"encoding/json"
)

// Feedback is a single piece of user feedback (general or in-interview). Context
// carries page/session/interview debug details for reproduction.
type Feedback struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id,omitempty"`
	Email     string          `json:"email,omitempty"`
	Kind      string          `json:"kind"`
	Message   string          `json:"message"`
	Rating    int             `json:"rating,omitempty"`
	Context   json.RawMessage `json:"context,omitempty"`
	CreatedAt string          `json:"created_at"`
}

// SaveFeedback stores one feedback row and returns its id.
func (s *Store) SaveFeedback(ctx context.Context, userID, kind, message string, rating int, contextJSON json.RawMessage) (string, error) {
	if len(contextJSON) == 0 {
		contextJSON = json.RawMessage(`{}`)
	}
	id := NewID()
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO feedback (id, user_id, kind, message, rating, context) VALUES ($1,$2,$3,$4,$5,$6)`,
		id, userID, kind, message, rating, contextJSON)
	return id, err
}

// ListFeedback returns recent feedback (newest first) with the submitter's email
// joined in — for admin/debug review.
func (s *Store) ListFeedback(ctx context.Context, limit int) ([]Feedback, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT f.id, f.user_id, COALESCE(u.email, ''), f.kind, f.message, f.rating, f.context,
		       to_char(f.created_at, 'YYYY-MM-DD"T"HH24:MI:SS')
		FROM feedback f LEFT JOIN users u ON u.id = f.user_id
		ORDER BY f.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Feedback
	for rows.Next() {
		var f Feedback
		if err := rows.Scan(&f.ID, &f.UserID, &f.Email, &f.Kind, &f.Message, &f.Rating, &f.Context, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
