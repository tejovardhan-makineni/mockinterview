package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrNotFound = errors.New("not found")

type User struct {
	ID                 string
	Email              string
	PasswordHash       string
	Role               string
	EmailVerified      bool
	TokenVersion       int
	AdultConfirmedAt   *time.Time
	TermsVersion       string
	PrivacyVersion     string
	PoliciesAcceptedAt *time.Time
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash string) (User, error) {
	u := User{ID: NewID(), Email: email, PasswordHash: passwordHash}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
		u.ID, u.Email, u.PasswordHash)
	return u, err
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := s.Pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE email=$1`, email).
		Scan(userDestinations(&u)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	var u User
	err := s.Pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id=$1`, id).
		Scan(userDestinations(&u)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

// Settings (profile) is free-form JSON stored on the user row (DOB, gender,
// occupation, domain, student/working status, etc.).
func (s *Store) GetSettings(ctx context.Context, userID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := s.Pool.QueryRow(ctx, `SELECT settings FROM users WHERE id=$1`, userID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return json.RawMessage(`{}`), ErrNotFound
	}
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	return raw, err
}

func (s *Store) SaveSettings(ctx context.Context, userID string, settings json.RawMessage) error {
	if len(settings) == 0 {
		settings = json.RawMessage(`{}`)
	}
	_, err := s.Pool.Exec(ctx, `UPDATE users SET settings=$2 WHERE id=$1`, userID, settings)
	return err
}

// DeleteUser removes the user; every related table has ON DELETE CASCADE, so
// this erases all of their data (resumes, sessions, transcripts, scores, ...).
func (s *Store) DeleteUser(ctx context.Context, userID string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Only a verified owner may erase a pre-added tester invitation.
	if _, err := tx.Exec(ctx, `DELETE FROM tester_emails t USING users u WHERE u.id=$1 AND u.email_verified=true AND t.email=lower(btrim(u.email))`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
