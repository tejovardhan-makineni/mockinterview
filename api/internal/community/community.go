// Package community handles private participation and opt-in product evidence.
package community

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

const ConsentVersion = "2026-10-04"

type Repo interface {
	store.CommunityStore
	UserByID(context.Context, string) (store.User, error)
	IsTester(context.Context, string) (bool, error)
	ListFeedback(context.Context, int) ([]store.Feedback, error)
}
type Service struct {
	store         Repo
	localRequests bool
}

func New(st Repo) *Service { return &Service{store: st} }

// NewDesktop allows the bridge-authenticated local profile to save template
// ideas without an email account. Hosted sharing and beta access still require
// verification; the desktop sharing proxy authenticates them separately.
func NewDesktop(st Repo) *Service { return &Service{store: st, localRequests: true} }
func (s *Service) admin(w http.ResponseWriter, r *http.Request) bool {
	u, err := s.store.UserByID(r.Context(), auth.UserID(r.Context()))
	if err != nil || !store.IsAdministrator(u) {
		httpx.WriteProblem(w, 403, "Administrator access required")
		return false
	}
	return true
}
func (s *Service) verified(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := auth.UserID(r.Context())
	u, err := s.store.UserByID(r.Context(), uid)
	if err != nil || !u.EmailVerified {
		httpx.WriteProblem(w, 403, "Verify your email to continue")
		return "", false
	}
	return uid, true
}
func (s *Service) BetaStatus(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	a, err := s.store.BetaApplication(r.Context(), uid)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		httpx.WriteProblem(w, 503, "Could not load beta status")
		return
	}
	tester, e := s.store.IsTester(r.Context(), uid)
	if e != nil {
		httpx.WriteProblem(w, 503, "Could not load beta status")
		return
	}
	var item *store.BetaApplication
	if err == nil {
		item = &a
	}
	httpx.WriteJSON(w, 200, map[string]any{"application": item, "unlimited": tester})
}
func (s *Service) ApplyBeta(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.verified(w, r)
	if !ok {
		return
	}
	var req struct {
		Motivation         string `json:"motivation"`
		FeedbackCommitment bool   `json:"feedback_commitment"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Motivation = strings.TrimSpace(req.Motivation)
	if !req.FeedbackCommitment || !length(req.Motivation, 10, 2000) {
		httpx.WriteProblem(w, 400, "Tell us what you will test (10–2,000 characters) and agree to provide feedback")
		return
	}
	a, err := s.store.ApplyBeta(r.Context(), uid, redact(req.Motivation))
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not save application")
		return
	}
	httpx.WriteJSON(w, 200, a)
}
func (s *Service) RequestTemplate(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if s.localRequests {
		if _, err := s.store.UserByID(r.Context(), uid); err != nil {
			httpx.WriteProblem(w, 401, "Local profile required")
			return
		}
	} else {
		var ok bool
		uid, ok = s.verified(w, r)
		if !ok {
			return
		}
	}
	var req struct {
		Profession  string `json:"profession"`
		Goal        string `json:"goal"`
		Level       string `json:"level"`
		Description string `json:"description"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Profession = strings.TrimSpace(req.Profession)
	req.Goal = strings.TrimSpace(req.Goal)
	req.Level = strings.TrimSpace(req.Level)
	req.Description = strings.TrimSpace(req.Description)
	if !length(req.Profession, 1, 160) || !length(req.Goal, 1, 500) || !length(req.Level, 1, 120) || !length(req.Description, 10, 3000) {
		httpx.WriteProblem(w, 400, "Add a profession, goal, level, and a request of 10–3,000 characters")
		return
	}
	a, err := s.store.SaveTemplateRequest(r.Context(), store.TemplateRequest{UserID: uid, Profession: redact(req.Profession), Goal: redact(req.Goal), Level: redact(req.Level), Description: redact(req.Description)})
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not save template request")
		return
	}
	httpx.WriteJSON(w, 201, a)
}
func (s *Service) AdminOverview(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	a, err := s.store.ListBetaApplications(r.Context())
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not load applications")
		return
	}
	t, err := s.store.ListTemplateRequests(r.Context())
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not load requests")
		return
	}
	u, err := s.store.ListSharedInterviewResults(r.Context())
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not load shared results")
		return
	}
	f, err := s.store.ListFeedback(r.Context(), 200)
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not load feedback")
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"applications": a, "requests": t, "uploads": u, "feedback": f})
}
func (s *Service) ReviewBeta(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Status != "approved" && req.Status != "rejected" {
		httpx.WriteProblem(w, 400, "Select approved or rejected")
		return
	}
	err := s.store.ReviewBetaApplication(r.Context(), chi.URLParam(r, "id"), req.Status, auth.UserID(r.Context()))
	reviewResponse(w, err)
}
func (s *Service) ReviewTemplate(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case "new", "planned", "shipped", "closed":
	default:
		httpx.WriteProblem(w, 400, "Invalid request status")
		return
	}
	err := s.store.ReviewTemplateRequest(r.Context(), chi.URLParam(r, "id"), req.Status, auth.UserID(r.Context()))
	reviewResponse(w, err)
}
func reviewResponse(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		httpx.WriteProblem(w, 404, "Item or verified applicant not found")
		return
	}
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not save review")
		return
	}
	w.WriteHeader(204)
}
func length(s string, min, max int) bool { n := utf8.RuneCountInString(s); return n >= min && n <= max }

var secrets = regexp.MustCompile(`(?i)(?:(?:sk-|xai-)[a-z0-9_-]{8,}|AIza[a-z0-9_-]{20,}|Bearer\s+[a-z0-9._-]+|(?:api[_ -]?key|password|token)\s*[:=]\s*[^\s,;]+)`)

func redact(s string) string { return secrets.ReplaceAllString(s, "[redacted]") }

// The schema intentionally has no transcript, resume, credential, or arbitrary
// context fields. Unknown fields are rejected instead of becoming a data sink.
type SharedReport struct {
	Overall    float64       `json:"overall"`
	Scored     bool          `json:"scored"`
	CoachingMD string        `json:"coaching_md"`
	Scores     []SharedScore `json:"scores,omitempty"`
}
type SharedScore struct {
	Dimension string  `json:"dimension"`
	Score     float64 `json:"score"`
	Rationale string  `json:"rationale,omitempty"`
}
type AnalyticsPayload struct {
	Consent         bool          `json:"consent"`
	ConsentVersion  string        `json:"consent_version"`
	ClientSessionID string        `json:"client_session_id"`
	Source          string        `json:"source"`
	Status          string        `json:"status"`
	Provider        string        `json:"provider"`
	Model           string        `json:"model"`
	DurationSeconds int           `json:"duration_seconds"`
	TurnCount       int           `json:"turn_count"`
	ErrorCount      int           `json:"error_count"`
	Score           *float64      `json:"score,omitempty"`
	Feedback        string        `json:"feedback,omitempty"`
	Report          *SharedReport `json:"report,omitempty"`
}

var opaqueID = regexp.MustCompile(`^[a-zA-Z0-9._:-]{1,120}$`)

func (s *Service) ShareAnalytics(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.verified(w, r)
	if !ok {
		return
	}
	var req AnalyticsPayload
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if !req.Consent || req.ConsentVersion != ConsentVersion {
		httpx.WriteProblem(w, 400, "Share analytics consent is required")
		return
	}
	if !opaqueID.MatchString(req.ClientSessionID) || !length(req.Provider, 0, 80) || !length(req.Model, 0, 160) || !length(req.Feedback, 0, 5000) || req.DurationSeconds < 0 || req.DurationSeconds > 86400 || req.TurnCount < 0 || req.TurnCount > 100000 || req.ErrorCount < 0 || req.ErrorCount > 10000 {
		httpx.WriteProblem(w, 400, "Invalid interview metrics")
		return
	}
	// Accept uploads only from supported clients. The historical database
	// constraint in 0014 remains unchanged so retired-client records stay
	// readable, exportable and deletable without rewriting released migrations.
	switch req.Source {
	case "web", "local":
	default:
		httpx.WriteProblem(w, 400, "Invalid client source")
		return
	}
	switch req.Status {
	case "complete", "failed", "interrupted", "abandoned":
	default:
		httpx.WriteProblem(w, 400, "Invalid interview status")
		return
	}
	if req.Score != nil && !validScore(*req.Score) {
		httpx.WriteProblem(w, 400, "Invalid interview score")
		return
	}
	req.Feedback = redact(req.Feedback)
	req.Provider = redact(req.Provider)
	req.Model = redact(req.Model)
	if req.Report != nil {
		if !validScore(req.Report.Overall) || !length(req.Report.CoachingMD, 0, 40000) || len(req.Report.Scores) > 50 {
			httpx.WriteProblem(w, 400, "Invalid interview report")
			return
		}
		req.Report.CoachingMD = redact(req.Report.CoachingMD)
		for i := range req.Report.Scores {
			row := &req.Report.Scores[i]
			if !length(row.Dimension, 1, 160) || !length(row.Rationale, 0, 4000) || !validScore(row.Score) {
				httpx.WriteProblem(w, 400, "Invalid report score")
				return
			}
			row.Dimension = redact(row.Dimension)
			row.Rationale = redact(row.Rationale)
		}
	}
	payload, err := json.Marshal(req)
	if err != nil {
		httpx.WriteProblem(w, 400, "Invalid interview result")
		return
	}
	if len(payload) > 64<<10 {
		httpx.WriteProblem(w, 413, "Shared result must be 64 KiB or smaller")
		return
	}
	id, err := s.store.SaveSharedInterviewResult(r.Context(), store.SharedInterviewResult{UserID: uid, ClientSessionID: req.ClientSessionID, Source: req.Source, ConsentVersion: req.ConsentVersion, Payload: payload})
	if err != nil {
		httpx.WriteProblem(w, 503, "Analytics unavailable")
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"id": id})
}
func validScore(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 100 }
func (s *Service) DeleteAnalytics(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.WriteProblem(w, 401, "Sign in to continue")
		return
	}
	if err := s.store.DeleteSharedInterviewResults(r.Context(), uid); err != nil {
		httpx.WriteProblem(w, 503, "Could not delete shared analytics")
		return
	}
	w.WriteHeader(204)
}
