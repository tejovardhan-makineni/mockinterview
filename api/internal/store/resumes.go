package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

type Resume struct {
	ID         string          `json:"id"`
	Filename   string          `json:"filename"`
	ParsedText string          `json:"-"`
	ParsedJSON json.RawMessage `json:"parsed"`
}

// SaveResume upserts the user's resume (we keep only the latest per user for
// simplicity — a new upload replaces the old). The delete+insert run in one
// transaction so a mid-way failure can't leave the user with no resume at all.
func (s *Store) SaveResume(ctx context.Context, userID, filename, parsedText string, parsedJSON json.RawMessage) (Resume, error) {
	if len(parsedJSON) == 0 {
		parsedJSON = json.RawMessage(`{}`)
	}
	r := Resume{ID: NewID(), Filename: filename, ParsedText: parsedText, ParsedJSON: parsedJSON}
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM resumes WHERE user_id=$1`, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO resumes (id, user_id, filename, parsed_text, parsed_json) VALUES ($1,$2,$3,$4,$5)`,
			r.ID, userID, filename, parsedText, parsedJSON)
		return err
	})
	if err != nil {
		return Resume{}, err
	}
	return r, nil
}

func (s *Store) LatestResume(ctx context.Context, userID string) (Resume, error) {
	var r Resume
	err := s.Pool.QueryRow(ctx,
		`SELECT id, filename, parsed_text, parsed_json FROM resumes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, userID).
		Scan(&r.ID, &r.Filename, &r.ParsedText, &r.ParsedJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

// DeleteResumes atomically removes all uploads and standalone reviews owned by
// the user, including reviews whose previous upload was replaced. Deleting an
// upload alone only sets resume_reviews.resume_id to NULL; it does not erase
// review content. Session context and interview reports are intentionally kept.
func (s *Store) DeleteResumes(ctx context.Context, userID string) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		// Remove uploads first so an in-flight review cannot insert a reference
		// to a deleted upload between clearing reviews and clearing uploads.
		if _, err := tx.Exec(ctx, `DELETE FROM resumes WHERE user_id=$1`, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM resume_reviews WHERE user_id=$1`, userID)
		return err
	})
}

func (s *Store) SaveResumeReview(ctx context.Context, userID, resumeID, provider, model string, result json.RawMessage) (string, error) {
	id := NewID()
	var resumePtr any
	if resumeID != "" {
		resumePtr = resumeID
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO resume_reviews (id, user_id, resume_id, provider, model, result) VALUES ($1,$2,$3,$4,$5,$6)`,
		id, userID, resumePtr, provider, model, result)
	return id, err
}
