// Package feedback captures user feedback — general, or submitted DURING an
// interview with the interview's debug context attached — so reported problems
// can be reproduced. A small admin-gated list endpoint surfaces recent feedback.
package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/go-chi/chi/v5"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

const maxMessage = 5000

// Repo is the persistence this package needs. *store.Store satisfies it.
type Repo interface {
	store.InterviewFeedbackStore
	IsTester(context.Context, string) (bool, error)
	GetReport(context.Context, string) (store.Report, []store.ScoreRow, error)
	GetSession(context.Context, string) (store.Session, error)
	SaveFeedback(ctx context.Context, userID, kind, message string, rating int, contextJSON json.RawMessage) (string, error)
	ListFeedback(ctx context.Context, limit int) ([]store.Feedback, error)
	UpdateFeedbackStatus(context.Context, string, string) error
	UserByID(ctx context.Context, id string) (store.User, error)
}

type Service struct{ store Repo }

// Legacy email argument is intentionally ignored; only stored roles authorize administration.
func New(st Repo, _ []string) *Service { return &Service{store: st} }

type submitReq struct {
	SessionID          string          `json:"session_id"`
	Tags               []string        `json:"tags"`
	IncludeDiagnostics bool            `json:"include_diagnostics"`
	ShareTranscript    bool            `json:"share_transcript"`
	Kind               string          `json:"kind"`
	Message            string          `json:"message"`
	Rating             int             `json:"rating"`
	Context            json.RawMessage `json:"context"`
}

// Submit stores one feedback item for the authenticated user.
func (s *Service) Submit(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req submitReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" && (req.Rating < 1 || req.Rating > 5) {
		httpx.WriteProblem(w, http.StatusBadRequest, "Add a rating or a comment")
		return
	}
	if len(msg) > maxMessage {
		msg = clip(msg, maxMessage)
	}
	kind := req.Kind
	if kind == "" {
		kind = "general"
	}
	switch kind {
	case "general", "interview", "interviewer", "product", "question", "report":
	default:
		httpx.WriteProblem(w, 400, "Invalid feedback category")
		return
	}
	rating := req.Rating
	if rating < 0 || rating > 5 {
		httpx.WriteProblem(w, 400, "Rating must be between 1 and 5")
		return
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(req.Context, &raw)
	if req.SessionID == "" {
		_ = json.Unmarshal(raw["session_id"], &req.SessionID)
	}
	safe := map[string]any{"include_diagnostics": req.IncludeDiagnostics, "share_transcript": req.ShareTranscript}
	var target string
	if json.Unmarshal(raw["target"], &target) == nil {
		switch target {
		case "interviewer_realism", "product_experience", "question_accuracy", "assessment_usefulness":
			safe["target"] = target
		}
	}
	if req.SessionID != "" {
		session, e := s.store.GetSession(r.Context(), req.SessionID)
		if e != nil || session.UserID != uid {
			httpx.WriteProblem(w, 403, "Feedback must refer to your own interview")
			return
		}
		safe["session_id"] = session.ID
		safe["question_id"] = session.QuestionID
		safe["provider"] = session.Provider
		safe["model"] = session.Model
	}
	if len(req.Tags) > 10 {
		httpx.WriteProblem(w, 400, "Too many feedback tags")
		return
	}
	tags := []string{}
	for _, tag := range req.Tags {
		if len(tag) > 80 {
			httpx.WriteProblem(w, 400, "Feedback tag is too long")
			return
		}
		tags = append(tags, redact(tag))
	}
	safe["tags"] = tags
	if req.IncludeDiagnostics {
		for _, key := range []string{"connection", "mode", "ai_state", "status", "release", "format_version", "prompt_version", "page"} {
			var value string
			if json.Unmarshal(raw[key], &value) == nil && value != "" {
				safe[key] = redact(clip(value, 160))
			}
		}
	}
	if req.ShareTranscript && req.SessionID != "" {
		var turns []struct {
			Role string `json:"role"`
			Text string `json:"text"`
		}
		if json.Unmarshal(raw["transcript_tail"], &turns) == nil {
			if len(turns) > 12 {
				turns = turns[len(turns)-12:]
			}
			for i := range turns {
				turns[i].Text = redact(clip(turns[i].Text, 1000))
				if turns[i].Role != "candidate" && turns[i].Role != "interviewer" {
					turns[i].Role = "system"
				}
			}
			safe["transcript_tail"] = turns
		}
	}
	req.Context, _ = json.Marshal(safe)
	msg = redact(msg)
	id, err := s.store.SaveFeedback(r.Context(), uid, kind, msg, rating, req.Context)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "could not save feedback")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// List returns recent feedback for admins (debug review); 403 for everyone else.
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	u, err := s.store.UserByID(r.Context(), uid)
	if err != nil || u.Role != "admin" {
		httpx.WriteProblem(w, http.StatusForbidden, "admins only")
		return
	}
	items, err := s.store.ListFeedback(r.Context(), 200)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "could not load feedback")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, items)
}

// clip truncates to at most n bytes without splitting a UTF-8 rune.
func clip(s string, n int) string {
	if n <= 0 || len(s) <= n {
		if n <= 0 {
			return ""
		}
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

var secretPattern = regexp.MustCompile(`(?i)(?:(?:sk-|xai-)[a-z0-9_-]{8,}|AIza[a-z0-9_-]{20,}|Bearer\s+[a-z0-9._-]+|(?:api[_ -]?key|password|token)\s*[:=]\s*[^\s,;]+)`)

func redact(v string) string { return secretPattern.ReplaceAllString(v, "[redacted]") }

// Triage records the maintainer's review state; it never changes submitted text.
func (s *Service) Triage(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.UserByID(r.Context(), auth.UserID(r.Context()))
	if err != nil || u.Role != "admin" {
		httpx.WriteProblem(w, 403, "admins only")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case "new", "reviewed", "planned", "resolved":
	default:
		httpx.WriteProblem(w, 400, "Invalid review status")
		return
	}
	if err = s.store.UpdateFeedbackStatus(r.Context(), chi.URLParam(r, "id"), req.Status); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.WriteProblem(w, 404, "Feedback not found")
		} else {
			httpx.WriteProblem(w, 503, "Review status could not be saved")
		}
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"status": req.Status})
}
