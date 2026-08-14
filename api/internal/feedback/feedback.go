// Package feedback captures user feedback — general, or submitted DURING an
// interview with the interview's debug context attached — so reported problems
// can be reproduced. A small admin-gated list endpoint surfaces recent feedback.
package feedback

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

const maxMessage = 5000

// Repo is the persistence this package needs. *store.Store satisfies it.
type Repo interface {
	SaveFeedback(ctx context.Context, userID, kind, message string, rating int, contextJSON json.RawMessage) (string, error)
	ListFeedback(ctx context.Context, limit int) ([]store.Feedback, error)
	UserByID(ctx context.Context, id string) (store.User, error)
}

type Service struct {
	store  Repo
	admins map[string]bool
}

func New(st Repo, adminEmails []string) *Service {
	admins := map[string]bool{}
	for _, e := range adminEmails {
		admins[strings.ToLower(strings.TrimSpace(e))] = true
	}
	return &Service{store: st, admins: admins}
}

type submitReq struct {
	Kind    string          `json:"kind"`
	Message string          `json:"message"`
	Rating  int             `json:"rating"`
	Context json.RawMessage `json:"context"`
}

// Submit stores one feedback item for the authenticated user.
func (s *Service) Submit(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req submitReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		httpx.WriteProblem(w, http.StatusBadRequest, "feedback message is required")
		return
	}
	if len(msg) > maxMessage {
		msg = clip(msg, maxMessage)
	}
	kind := "general"
	if req.Kind == "interview" {
		kind = "interview"
	}
	rating := req.Rating
	if rating < 0 {
		rating = 0
	}
	if rating > 5 {
		rating = 5
	}
	if len(req.Context) > 0 && !json.Valid(req.Context) {
		req.Context = nil
	}
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
	if err != nil || !s.admins[strings.ToLower(u.Email)] {
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
