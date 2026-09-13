package store

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"
)

var ErrInvalidTesterEmail = errors.New("provide a valid email address without a display name")

type Tester struct {
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

type TesterStore interface {
	ListTesters(context.Context) ([]Tester, error)
	AddTester(context.Context, string) (Tester, error)
	RemoveTester(context.Context, string) error
	IsTester(context.Context, string) (bool, error)
}

// NormalizeTesterEmail deliberately does not merge provider aliases: access is
// granted only to the exact mailbox requested by an administrator.
func NormalizeTesterEmail(email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || len(email) > 254 || parsed.Name != "" || parsed.Address != email || strings.ContainsAny(email, "\r\n\x00") {
		return "", ErrInvalidTesterEmail
	}
	return email, nil
}

const testerEligibleSQL = `EXISTS(SELECT 1 FROM users u JOIN tester_emails t ON t.email=lower(btrim(u.email)) WHERE u.id=$1 AND u.email_verified=true)`

func readTester(ctx context.Context, q queryer, uid string) (bool, error) {
	var tester bool
	err := q.QueryRow(ctx, `SELECT `+testerEligibleSQL, uid).Scan(&tester)
	return tester, err
}

func (s *Store) IsTester(ctx context.Context, uid string) (bool, error) {
	return readTester(ctx, s.Pool, uid)
}

func (s *Store) ListTesters(ctx context.Context) ([]Tester, error) {
	rows, err := s.Pool.Query(ctx, `SELECT email,created_at FROM tester_emails ORDER BY email`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Tester{}
	for rows.Next() {
		var item Tester
		if err := rows.Scan(&item.Email, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) AddTester(ctx context.Context, email string) (Tester, error) {
	email, err := NormalizeTesterEmail(email)
	if err != nil {
		return Tester{}, err
	}
	var item Tester
	err = s.Pool.QueryRow(ctx, `INSERT INTO tester_emails(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING email,created_at`, email).Scan(&item.Email, &item.CreatedAt)
	return item, err
}

func (s *Store) RemoveTester(ctx context.Context, email string) error {
	email, err := NormalizeTesterEmail(email)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `DELETE FROM tester_emails WHERE email=$1`, email)
	return err
}
