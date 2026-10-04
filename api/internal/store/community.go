package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// OwnerEmail does not itself confer privileges. Administration also requires a
// verified account and an operator-provisioned role, read from storage each time.
const OwnerEmail = "makinenitejovardhan@gmail.com"

func IsAdministrator(u User) bool {
	return u.Role == "admin" && u.EmailVerified && strings.EqualFold(strings.TrimSpace(u.Email), OwnerEmail)
}

type BetaApplication struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	Email              string     `json:"email,omitempty"`
	Motivation         string     `json:"motivation"`
	FeedbackCommitment bool       `json:"feedback_commitment"`
	Status             string     `json:"status"`
	CreatedAt          time.Time  `json:"created_at"`
	ReviewedAt         *time.Time `json:"reviewed_at,omitempty"`
}
type TemplateRequest struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Email       string    `json:"email,omitempty"`
	Profession  string    `json:"profession"`
	Goal        string    `json:"goal"`
	Level       string    `json:"level"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}
type SharedInterviewResult struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	ClientSessionID string          `json:"client_session_id"`
	Source          string          `json:"source"`
	ConsentVersion  string          `json:"consent_version"`
	Payload         json.RawMessage `json:"payload"`
	CreatedAt       time.Time       `json:"created_at"`
}
type CommunityStore interface {
	BetaApplication(context.Context, string) (BetaApplication, error)
	ApplyBeta(context.Context, string, string) (BetaApplication, error)
	ListBetaApplications(context.Context) ([]BetaApplication, error)
	ReviewBetaApplication(context.Context, string, string, string) error
	SaveTemplateRequest(context.Context, TemplateRequest) (TemplateRequest, error)
	ListTemplateRequests(context.Context) ([]TemplateRequest, error)
	ReviewTemplateRequest(context.Context, string, string, string) error
	SaveSharedInterviewResult(context.Context, SharedInterviewResult) (string, error)
	ListSharedInterviewResults(context.Context) ([]SharedInterviewResult, error)
	DeleteSharedInterviewResults(context.Context, string) error
}

func communityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func (s *Store) BetaApplication(ctx context.Context, uid string) (BetaApplication, error) {
	var a BetaApplication
	err := s.Pool.QueryRow(ctx, `SELECT id,user_id,motivation,feedback_commitment,status,created_at,reviewed_at FROM beta_applications WHERE user_id=$1`, uid).Scan(&a.ID, &a.UserID, &a.Motivation, &a.FeedbackCommitment, &a.Status, &a.CreatedAt, &a.ReviewedAt)
	return a, communityError(err)
}
func (s *Store) ApplyBeta(ctx context.Context, uid, motivation string) (BetaApplication, error) {
	// An approved or pending application is immutable to the applicant; reapplying
	// after rejection returns it to the review queue without granting access.
	_, err := s.Pool.Exec(ctx, `INSERT INTO beta_applications(id,user_id,motivation,feedback_commitment) VALUES($1,$2,$3,true)
 ON CONFLICT(user_id) DO UPDATE SET motivation=EXCLUDED.motivation,status='pending',commitment_at=now(),reviewed_at=NULL,reviewed_by=NULL WHERE beta_applications.status='rejected'`, NewID(), uid, motivation)
	if err != nil {
		return BetaApplication{}, err
	}
	return s.BetaApplication(ctx, uid)
}
func (s *Store) ListBetaApplications(ctx context.Context) ([]BetaApplication, error) {
	rows, err := s.Pool.Query(ctx, `SELECT b.id,b.user_id,u.email,b.motivation,b.feedback_commitment,b.status,b.created_at,b.reviewed_at FROM beta_applications b JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []BetaApplication{}
	for rows.Next() {
		var a BetaApplication
		if err = rows.Scan(&a.ID, &a.UserID, &a.Email, &a.Motivation, &a.FeedbackCommitment, &a.Status, &a.CreatedAt, &a.ReviewedAt); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	return items, rows.Err()
}
func (s *Store) ReviewBetaApplication(ctx context.Context, id, status, reviewer string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var email string
	// Lock account and application together. Approval and tester access commit atomically.
	err = tx.QueryRow(ctx, `SELECT lower(btrim(u.email)) FROM beta_applications b JOIN users u ON u.id=b.user_id WHERE b.id=$1 AND b.feedback_commitment=true AND u.email_verified=true FOR UPDATE OF b,u`, id).Scan(&email)
	if err != nil {
		return communityError(err)
	}
	if status == "approved" {
		_, err = tx.Exec(ctx, `INSERT INTO tester_emails(email) VALUES($1) ON CONFLICT DO NOTHING`, email)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM tester_emails WHERE email=$1`, email)
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE beta_applications SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`, id, status, reviewer); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) SaveTemplateRequest(ctx context.Context, a TemplateRequest) (TemplateRequest, error) {
	a.ID = NewID()
	a.Status = "new"
	err := s.Pool.QueryRow(ctx, `INSERT INTO template_requests(id,user_id,profession,goal,level,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING created_at`, a.ID, a.UserID, a.Profession, a.Goal, a.Level, a.Description).Scan(&a.CreatedAt)
	return a, err
}
func (s *Store) ListTemplateRequests(ctx context.Context) ([]TemplateRequest, error) {
	rows, err := s.Pool.Query(ctx, `SELECT t.id,t.user_id,u.email,t.profession,t.goal,t.level,t.description,t.status,t.created_at FROM template_requests t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []TemplateRequest{}
	for rows.Next() {
		var a TemplateRequest
		if err = rows.Scan(&a.ID, &a.UserID, &a.Email, &a.Profession, &a.Goal, &a.Level, &a.Description, &a.Status, &a.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	return items, rows.Err()
}
func (s *Store) ReviewTemplateRequest(ctx context.Context, id, status, reviewer string) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE template_requests SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1`, id, status, reviewer)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}
func (s *Store) SaveSharedInterviewResult(ctx context.Context, a SharedInterviewResult) (string, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `INSERT INTO shared_interview_results(id,user_id,client_session_id,source,consent_version,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,source,client_session_id) DO UPDATE SET payload=EXCLUDED.payload,consent_version=EXCLUDED.consent_version,consent_at=now(),updated_at=now() RETURNING id`, NewID(), a.UserID, a.ClientSessionID, a.Source, a.ConsentVersion, a.Payload).Scan(&id)
	return id, err
}
func (s *Store) ListSharedInterviewResults(ctx context.Context) ([]SharedInterviewResult, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id,user_id,client_session_id,source,consent_version,payload,created_at FROM shared_interview_results ORDER BY updated_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []SharedInterviewResult{}
	for rows.Next() {
		var a SharedInterviewResult
		if err = rows.Scan(&a.ID, &a.UserID, &a.ClientSessionID, &a.Source, &a.ConsentVersion, &a.Payload, &a.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	return items, rows.Err()
}
func (s *Store) DeleteSharedInterviewResults(ctx context.Context, uid string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM shared_interview_results WHERE user_id=$1`, uid)
	return err
}
