package store

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

var ErrActionThrottled = errors.New("action requested too recently")

// AccountStore persists single-use hashed email actions and revocable sessions.
type AccountStore interface {
	SaveAuthAction(context.Context, string, string, string, time.Time) error
	ConsumeAuthAction(context.Context, string, string, string) (string, error)
	ChangePassword(context.Context, string, string, string) error
	RevokeSessions(context.Context, string) error
}

func (s *Store) SaveAuthAction(ctx context.Context, uid, purpose, hash string, expires time.Time) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var found string
	if err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, uid).Scan(&found); err != nil {
		return err
	}
	var recent bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM auth_actions WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '1 minute')`, uid, purpose).Scan(&recent); err != nil {
		return err
	}
	if recent {
		return ErrActionThrottled
	}
	if _, err = tx.Exec(ctx, `DELETE FROM auth_actions WHERE user_id=$1 AND purpose=$2`, uid, purpose); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO auth_actions(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,$4)`, hash, uid, purpose, expires); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ConsumeAuthAction(ctx context.Context, hash, purpose, passwordHash string) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var uid string
	err = tx.QueryRow(ctx, `DELETE FROM auth_actions WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING user_id`, hash, purpose).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if purpose == "verify" {
		_, err = tx.Exec(ctx, `UPDATE users SET email_verified=true WHERE id=$1`, uid)
	} else if purpose == "reset" && passwordHash != "" {
		_, err = tx.Exec(ctx, `UPDATE users SET password_hash=$2,email_verified=true,token_version=token_version+1 WHERE id=$1`, uid, passwordHash)
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM auth_actions WHERE user_id=$1`, uid)
		}
	} else {
		return "", errors.New("invalid action")
	}
	if err != nil {
		return "", err
	}
	return uid, tx.Commit(ctx)
}

// Compare-and-swap prevents two concurrent password changes accepting a stale password.
func (s *Store) ChangePassword(ctx context.Context, uid, previous, next string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE users SET password_hash=$3,token_version=token_version+1 WHERE id=$1 AND password_hash=$2`, uid, previous, next)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	if _, err = tx.Exec(ctx, `DELETE FROM auth_actions WHERE user_id=$1`, uid); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) RevokeSessions(ctx context.Context, uid string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE users SET token_version=token_version+1 WHERE id=$1`, uid)
	return err
}
