// Package interview manages interview session lifecycle: create, fetch, record
// transcript/workspace, finish (which triggers scoring), and serve the report.
package interview

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
)

// Repo is the persistence the interview lifecycle needs. It includes the
// scoring.ReportStore methods (SaveScores/SaveReport) so the service can hand
// itself to the scorer's Persist. *store.Store satisfies it; tests supply a fake.
type Repo interface {
	UserByID(ctx context.Context, id string) (store.User, error)
	ListUserSessions(ctx context.Context, userID string, limit int) ([]store.SessionSummary, error)
	CountSessionsToday(ctx context.Context, userID string) (int, error)
	CreateSession(ctx context.Context, userID, questionID, modality, track string, cfg json.RawMessage) (store.Session, error)
	GetSession(ctx context.Context, id string) (store.Session, error)
	UpdateSessionStatus(ctx context.Context, id, status string) error
	AddTurn(ctx context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error
	Transcript(ctx context.Context, sessionID string) ([]store.Turn, error)
	AddWorkspaceSnapshot(ctx context.Context, sessionID string, tsMs int64, kind, content string) error
	LatestWorkspace(ctx context.Context, sessionID string) (string, error)
	AddBehaviorSample(ctx context.Context, sessionID string, tsMs int64, gaze, headPose, expression, posture, lighting, vad, framing json.RawMessage) error
	AddEvent(ctx context.Context, sessionID string, tsMs int64, kind string, data json.RawMessage) error
	BehavioralSummary(ctx context.Context, sessionID string) (json.RawMessage, error)
	GetReport(ctx context.Context, sessionID string) (store.Report, []store.ScoreRow, error)
	// scoring.ReportStore:
	SaveScores(ctx context.Context, sessionID string, rows []store.ScoreRow) error
	SaveReport(ctx context.Context, sessionID string, overall float64, radar, timeline, behavioral json.RawMessage, coachingMD string, scored bool, note string) error
}

type Service struct {
	store       Repo
	corpus      *corpus.Catalog
	scorer      *scoring.Engine
	adminEmails map[string]bool
	dailyLimit  int
}

func New(st Repo, cat *corpus.Catalog, sc *scoring.Engine, adminEmails []string, dailyLimit int) *Service {
	admins := map[string]bool{}
	for _, e := range adminEmails {
		admins[strings.ToLower(strings.TrimSpace(e))] = true
	}
	return &Service{store: st, corpus: cat, scorer: sc, adminEmails: admins, dailyLimit: dailyLimit}
}

func (s *Service) isAdmin(ctx context.Context, uid string) bool {
	u, err := s.store.UserByID(ctx, uid)
	if err != nil {
		return false
	}
	return s.adminEmails[strings.ToLower(u.Email)]
}

// List returns the user's past interviews (for the results/history page).
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	items, err := s.store.ListUserSessions(r.Context(), uid, 50)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "list failed")
		return
	}
	// Attach question titles.
	type row struct {
		store.SessionSummary
		Title string `json:"title"`
	}
	out := make([]row, 0, len(items))
	for _, it := range items {
		title := it.QuestionID
		if q, ok := s.corpus.Get(it.QuestionID); ok {
			title = q.Title
		}
		out = append(out, row{SessionSummary: it, Title: title})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

type createReq struct {
	QuestionID string          `json:"question_id"`
	Config     json.RawMessage `json:"config"`
}

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req createReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	q, ok := s.corpus.Get(req.QuestionID)
	if !ok {
		httpx.WriteProblem(w, http.StatusBadRequest, "unknown question_id")
		return
	}
	// Free-tier daily limit (cost control). Admins are unlimited.
	if s.dailyLimit > 0 && !s.isAdmin(r.Context(), uid) {
		if n, _ := s.store.CountSessionsToday(r.Context(), uid); n >= s.dailyLimit {
			httpx.WriteProblem(w, http.StatusTooManyRequests, fmt.Sprintf("Daily limit reached — the free tier allows %d interviews per day. Please try again tomorrow.", s.dailyLimit))
			return
		}
	}
	sess, err := s.store.CreateSession(r.Context(), uid, q.ID, q.Modality, q.Track, req.Config)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "create failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sess)
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sess)
}

type turnReq struct {
	Role string `json:"role"`
	Text string `json:"text"`
	TsMs int64  `json:"ts_ms"`
}

// AddTurn records a transcript turn (used by the client and the live relay).
func (s *Service) AddTurn(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	var req turnReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Role != "interviewer" && req.Role != "candidate" && req.Role != "system" {
		httpx.WriteProblem(w, http.StatusBadRequest, "role must be interviewer|candidate|system")
		return
	}
	if err := s.store.AddTurn(r.Context(), sess.ID, req.Role, req.Text, req.TsMs, nil); err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "save failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type workspaceReq struct {
	Kind    string `json:"kind"` // code|written|note
	Content string `json:"content"`
	TsMs    int64  `json:"ts_ms"`
}

func (s *Service) SaveWorkspace(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	var req workspaceReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if err := s.store.AddWorkspaceSnapshot(r.Context(), sess.ID, req.TsMs, req.Kind, req.Content); err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "save failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Finish scores the session and persists a report.
func (s *Service) Finish(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	q, found := s.corpus.Get(sess.QuestionID)
	if !found {
		httpx.WriteProblem(w, http.StatusInternalServerError, "question not found for session")
		return
	}
	_ = s.store.UpdateSessionStatus(r.Context(), sess.ID, "scoring")

	transcript, _ := s.store.Transcript(r.Context(), sess.ID)
	workspace, _ := s.store.LatestWorkspace(r.Context(), sess.ID)

	result, err := s.scorer.Evaluate(r.Context(), q, transcript, workspace)
	if err != nil {
		// Don't strand the session in "scoring" — reset so Finish can be retried.
		_ = s.store.UpdateSessionStatus(r.Context(), sess.ID, "active")
		httpx.WriteProblem(w, http.StatusBadGateway, "scoring failed: "+err.Error())
		return
	}
	// Behavioral summary is attached by the behavior package if present.
	behavioral, _ := s.store.BehavioralSummary(r.Context(), sess.ID)
	if err := s.scorer.Persist(r.Context(), s.store, sess.ID, result, behavioral); err != nil {
		_ = s.store.UpdateSessionStatus(r.Context(), sess.ID, "active")
		httpx.WriteProblem(w, http.StatusInternalServerError, "persist failed")
		return
	}
	_ = s.store.UpdateSessionStatus(r.Context(), sess.ID, "complete")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "overall": result.Overall})
}

// Report assembles the client-facing report from stored scores + report row.
func (s *Service) Report(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	rep, scores, err := s.store.GetReport(r.Context(), sess.ID)
	if err != nil {
		httpx.WriteProblem(w, http.StatusNotFound, "no report yet — finish the interview first")
		return
	}
	var radar struct {
		Strengths []string `json:"strengths"`
		Gaps      []string `json:"gaps"`
	}
	_ = json.Unmarshal(rep.Radar, &radar)

	title := sess.QuestionID
	if q, found := s.corpus.Get(sess.QuestionID); found {
		title = q.Title
	}
	workspace, _ := s.store.LatestWorkspace(r.Context(), sess.ID)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"session_id":     sess.ID,
		"question_title": title,
		"modality":       sess.Modality,
		"workspace":      workspace,
		"overall":        rep.Overall,
		"scores":         scores,
		"behavioral":     rep.Behavioral,
		"strengths":      radar.Strengths,
		"gaps":           radar.Gaps,
		"coaching_md":    rep.CoachingMD,
		"scored":         rep.Scored,
		"note":           rep.Note,
	})
}

// owned loads the session and verifies it belongs to the caller.
func (s *Service) owned(w http.ResponseWriter, r *http.Request) (store.Session, bool) {
	id := chi.URLParam(r, "id")
	sess, err := s.store.GetSession(r.Context(), id)
	if err != nil {
		httpx.WriteProblem(w, http.StatusNotFound, "session not found")
		return store.Session{}, false
	}
	if sess.UserID != auth.UserID(r.Context()) {
		httpx.WriteProblem(w, http.StatusForbidden, "not your session")
		return store.Session{}, false
	}
	return sess, true
}
