package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/tejo/mockinterview-api/internal/store"
	"strings"
	"time"
)

func isTester(ctx context.Context, q querier, id string) (bool, error) {
	u, e := readJSON[store.User](ctx, q, `SELECT data FROM users WHERE id=?`, id)
	if errors.Is(e, store.ErrNotFound) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if !u.EmailVerified {
		return false, nil
	}
	var exists bool
	e = q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tester_emails WHERE email=?)`, strings.ToLower(strings.TrimSpace(u.Email))).Scan(&exists)
	return exists, e
}
func (s *Store) IsTester(ctx context.Context, id string) (v bool, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error { var e error; v, e = isTester(ctx, tx, id); return e })
	return
}
func (s *Store) ListTesters(ctx context.Context) ([]store.Tester, error) {
	return listJSON[store.Tester](ctx, s.db, `SELECT data FROM tester_emails ORDER BY email`)
}
func addTester(ctx context.Context, q executor, email string) error {
	return execJSON(ctx, q, `INSERT INTO tester_emails(email,data) VALUES(?,?) ON CONFLICT(email) DO NOTHING`, store.Tester{Email: email, CreatedAt: time.Now().UTC()}, email)
}
func (s *Store) AddTester(ctx context.Context, email string) (item store.Tester, err error) {
	email, err = store.NormalizeTesterEmail(email)
	if err != nil {
		return
	}
	err = s.write(ctx, func(tx *sql.Tx) error {
		if e := addTester(ctx, tx, email); e != nil {
			return e
		}
		var e error
		item, e = readJSON[store.Tester](ctx, tx, `SELECT data FROM tester_emails WHERE email=?`, email)
		return e
	})
	return
}
func (s *Store) RemoveTester(ctx context.Context, email string) error {
	email, e := store.NormalizeTesterEmail(email)
	if e != nil {
		return e
	}
	_, e = s.db.ExecContext(ctx, `DELETE FROM tester_emails WHERE email=?`, email)
	return e
}
func (s *Store) BetaApplication(ctx context.Context, id string) (store.BetaApplication, error) {
	return readJSON[store.BetaApplication](ctx, s.db, `SELECT data FROM beta_applications WHERE user_id=?`, id)
}
func (s *Store) ApplyBeta(ctx context.Context, uid, motivation string) (a store.BetaApplication, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		u, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, uid)
		if e != nil {
			return e
		}
		a, e = readJSON[store.BetaApplication](ctx, tx, `SELECT data FROM beta_applications WHERE user_id=?`, uid)
		if e != nil && !errors.Is(e, store.ErrNotFound) {
			return e
		}
		if e == nil && a.Status != "rejected" {
			return nil
		}
		if errors.Is(e, store.ErrNotFound) {
			a = store.BetaApplication{ID: store.NewID(), UserID: uid, Email: u.Email, CreatedAt: time.Now().UTC()}
		}
		a.Motivation = motivation
		a.FeedbackCommitment = true
		a.Status = "pending"
		a.ReviewedAt = nil
		return execJSON(ctx, tx, `INSERT INTO beta_applications(id,user_id,created_at,data) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,reviewed_by=''`, a, a.ID, uid, a.CreatedAt.UnixMilli())
	})
	return
}
func (s *Store) ListBetaApplications(ctx context.Context) ([]store.BetaApplication, error) {
	return listJSON[store.BetaApplication](ctx, s.db, `SELECT data FROM beta_applications ORDER BY created_at DESC,id DESC LIMIT 200`)
}
func (s *Store) ReviewBetaApplication(ctx context.Context, id, status, reviewer string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if !oneOf(status, "approved", "rejected", "pending") {
			return errors.New("invalid beta status")
		}
		a, e := readJSON[store.BetaApplication](ctx, tx, `SELECT data FROM beta_applications WHERE id=?`, id)
		if e != nil {
			return e
		}
		u, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, a.UserID)
		if e != nil {
			return e
		}
		if !u.EmailVerified || !a.FeedbackCommitment {
			return store.ErrNotFound
		}
		email := strings.ToLower(strings.TrimSpace(u.Email))
		if status == "approved" {
			e = addTester(ctx, tx, email)
		} else {
			_, e = tx.ExecContext(ctx, `DELETE FROM tester_emails WHERE email=?`, email)
		}
		if e != nil {
			return e
		}
		now := time.Now().UTC()
		a.Status = status
		a.ReviewedAt = &now
		return execJSON(ctx, tx, `UPDATE beta_applications SET reviewed_by=?2,data=?3 WHERE id=?1`, a, id, reviewer)
	})
}
func (s *Store) SaveTemplateRequest(ctx context.Context, a store.TemplateRequest) (store.TemplateRequest, error) {
	u, e := s.UserByID(ctx, a.UserID)
	if e != nil {
		return a, e
	}
	a.ID = store.NewID()
	a.Status = "new"
	a.CreatedAt = time.Now().UTC()
	a.Email = u.Email
	e = execJSON(ctx, s.db, `INSERT INTO template_requests(id,user_id,created_at,data) VALUES(?,?,?,?)`, a, a.ID, a.UserID, a.CreatedAt.UnixMilli())
	return a, e
}
func (s *Store) ListTemplateRequests(ctx context.Context) ([]store.TemplateRequest, error) {
	return listJSON[store.TemplateRequest](ctx, s.db, `SELECT data FROM template_requests ORDER BY created_at DESC,id DESC LIMIT 200`)
}
func (s *Store) ReviewTemplateRequest(ctx context.Context, id, status, reviewer string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		a, e := readJSON[store.TemplateRequest](ctx, tx, `SELECT data FROM template_requests WHERE id=?`, id)
		if e != nil {
			return e
		}
		a.Status = status
		return execJSON(ctx, tx, `UPDATE template_requests SET reviewed_by=?2,data=?3 WHERE id=?1`, a, id, reviewer)
	})
}
func (s *Store) SaveSharedInterviewResult(ctx context.Context, a store.SharedInterviewResult) (id string, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		if a.ConsentVersion == "" {
			return errors.New("sharing requires a consent version")
		}
		old, e := readJSON[store.SharedInterviewResult](ctx, tx, `SELECT data FROM shared_interview_results WHERE user_id=? AND source=? AND client_session_id=?`, a.UserID, a.Source, a.ClientSessionID)
		if e != nil && !errors.Is(e, store.ErrNotFound) {
			return e
		}
		if e == nil {
			a.ID = old.ID
			a.CreatedAt = old.CreatedAt
		} else {
			a.ID = store.NewID()
			a.CreatedAt = time.Now().UTC()
		}
		id = a.ID
		return execJSON(ctx, tx, `INSERT INTO shared_interview_results(id,user_id,source,client_session_id,updated_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,source,client_session_id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data`, a, id, a.UserID, a.Source, a.ClientSessionID, nowMillis())
	})
	return
}
func (s *Store) ListSharedInterviewResults(ctx context.Context) ([]store.SharedInterviewResult, error) {
	return listJSON[store.SharedInterviewResult](ctx, s.db, `SELECT data FROM shared_interview_results ORDER BY updated_at DESC,id DESC LIMIT 200`)
}
func (s *Store) DeleteSharedInterviewResults(ctx context.Context, uid string) error {
	_, e := s.db.ExecContext(ctx, `DELETE FROM shared_interview_results WHERE user_id=?`, uid)
	return e
}
func (s *Store) SaveFeedback(ctx context.Context, uid, kind, message string, rating int, contextJSON json.RawMessage) (string, error) {
	u, e := s.UserByID(ctx, uid)
	if e != nil {
		return "", e
	}
	f := store.Feedback{ID: store.NewID(), UserID: uid, Email: u.Email, Kind: kind, Message: message, Rating: rating, Context: normalizeJSON(contextJSON), Status: "new", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	e = execJSON(ctx, s.db, `INSERT INTO feedback(id,user_id,created_at,data) VALUES(?,?,?,?)`, f, f.ID, uid, nowMillis())
	return f.ID, e
}
func (s *Store) ListFeedback(ctx context.Context, limit int) ([]store.Feedback, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	return listJSON[store.Feedback](ctx, s.db, `SELECT data FROM feedback ORDER BY created_at DESC,id DESC LIMIT ?`, limit)
}
func (s *Store) UpdateFeedbackStatus(ctx context.Context, id, status string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		f, e := readJSON[store.Feedback](ctx, tx, `SELECT data FROM feedback WHERE id=?`, id)
		if e != nil {
			return e
		}
		f.Status = status
		return execJSON(ctx, tx, `UPDATE feedback SET data=?2 WHERE id=?1`, f, id)
	})
}
