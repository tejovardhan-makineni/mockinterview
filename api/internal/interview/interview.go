// Package interview manages interview session lifecycle: create, fetch, record
// transcript/workspace, finish (which triggers scoring), and serve the report.
package interview

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/tejo/mockinterview-api/internal/live"
	"github.com/tejo/mockinterview-api/internal/llm"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

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
	store.SessionRuntime
	UserByID(ctx context.Context, id string) (store.User, error)
	ListUserSessions(ctx context.Context, userID string, limit int) ([]store.SessionSummary, error)
	CountSessionsToday(ctx context.Context, userID string) (int, error)
	CreateSession(ctx context.Context, userID, questionID, modality, track, packID, roundID string, cfg json.RawMessage) (store.Session, error)
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
	options  Options
	workerMu sync.Mutex
	wake     chan struct{}
	store    Repo
	corpus   *corpus.Catalog
	scorer   *scoring.Engine
	packs    PackResolver // may be nil
}

// The email list is retained in the constructor signature for compatibility;
// authorization comes exclusively from the stored user role.
func New(st Repo, cat *corpus.Catalog, sc *scoring.Engine, _ []string, dailyLimit int) *Service {
	return &Service{store: st, corpus: cat, scorer: sc, wake: make(chan struct{}, 1), options: Options{Hosted: dailyLimit > 0}}
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
	Minutes    int             `json:"minutes"`
	Funding    string          `json:"funding"`
	Provider   string          `json:"provider"`
	Model      string          `json:"model"`
	APIKey     string          `json:"api_key"`
	Mode       string          `json:"mode"`
	QuestionID string          `json:"question_id"`
	Config     json.RawMessage `json:"config"`
	PackID     string          `json:"pack_id,omitempty"`
	RoundID    string          `json:"round_id,omitempty"`
}

// PackResolver resolves a pack round to a concrete corpus question + an
// interviewer focus line. internal/pack's Service satisfies it; it's a
// consumer-defined seam so interview doesn't import pack (avoids a cycle) and is
// wired at the composition root via SetPacks. May be nil (packs disabled).
type PackResolver interface {
	ResolveRound(packID, roundID string) (questionID, focus string, ok bool)
}

// SetPacks wires the pack resolver after construction (composition root).
func (s *Service) SetPacks(p PackResolver) { s.packs = p }

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req createReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	// Pack round: resolve to a concrete question + interviewer focus, and stamp
	// the focus into the session config so the live director can specialize.
	var roundFocus string
	cfg, configErr := validateConfig(req.Config)
	if configErr != nil {
		httpx.WriteProblem(w, 400, configErr.Error())
		return
	}
	req.Config = cfg
	if req.PackID != "" && req.RoundID != "" && s.packs != nil {
		qid, focus, ok := s.packs.ResolveRound(req.PackID, req.RoundID)
		if resolver, found := s.packs.(interface {
			ResolveRoundForUser(context.Context, string, string, string) (string, string, int, bool)
		}); found {
			var minutes int
			qid, focus, minutes, ok = resolver.ResolveRoundForUser(r.Context(), uid, req.PackID, req.RoundID)
			if req.Minutes == 0 {
				req.Minutes = minutes
			}
		}
		if !ok {
			httpx.WriteProblem(w, http.StatusBadRequest, "unknown pack round")
			return
		}
		req.QuestionID = qid
		roundFocus = focus
	} else if req.PackID != "" || req.RoundID != "" {
		httpx.WriteProblem(w, 400, "select a valid pack and round")
		return
	}

	q, ok := s.corpus.Get(req.QuestionID)
	if !ok {
		httpx.WriteProblem(w, http.StatusBadRequest, "unknown question_id")
		return
	}
	if roundFocus != "" {
		req.Config = withRoundFocus(req.Config, roundFocus)
	}
	u, e := s.store.UserByID(r.Context(), uid)
	if e != nil {
		httpx.WriteProblem(w, 401, "account unavailable")
		return
	}
	if s.options.Hosted && !u.EmailVerified {
		httpx.WriteProblem(w, 403, "verify your email before starting an interview")
		return
	}
	if req.Minutes == 0 {
		req.Minutes = 30
	}
	if req.Minutes < 5 || req.Minutes > 60 {
		httpx.WriteProblem(w, 400, "duration must be 5–60 minutes")
		return
	}
	if req.Funding == "" {
		req.Funding = "platform"
	}
	if req.Mode == "" {
		req.Mode = "voice"
	}
	if req.Funding != "platform" && req.Funding != "byok" {
		httpx.WriteProblem(w, 400, "invalid funding mode")
		return
	}
	// Duration and live model are server-controlled and frozen for reconnects.
	var settings map[string]any
	_ = json.Unmarshal(req.Config, &settings)
	settings["minutes"] = req.Minutes
	settings["director_version"] = live.DirectorVersion
	settings["question_fingerprint"] = corpus.Fingerprint(q)
	if _, ok := settings["include_resume"]; !ok {
		settings["include_resume"] = false
	}
	req.Config, _ = json.Marshal(settings)
	id := store.NewID()
	var encrypted []byte
	if req.Funding == "byok" {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		client, err := llm.ValidatePersonalKey(ctx, req.Provider, req.Model, req.Mode, req.APIKey)
		if err != nil {
			httpx.WriteProblem(w, 400, err.Error())
			return
		}
		req.Model = client.Info().Model
		encrypted, e = llm.SealKey(s.options.EncryptionKey, uid, id, req.APIKey)
		if e != nil {
			httpx.WriteProblem(w, 503, "personal key storage is unavailable")
			return
		}
	} else {
		if req.APIKey != "" {
			httpx.WriteProblem(w, 400, "select personal-key funding before entering a key")
			return
		}
		req.Provider = s.options.PlatformProvider
		req.Model = s.options.PlatformModel
		if req.Mode != "voice" && req.Mode != "text" {
			httpx.WriteProblem(w, 400, "invalid interview mode")
			return
		}
	}
	snapshot, _ := json.Marshal(q)
	sess, err := s.store.ReserveSession(r.Context(), store.Reservation{GlobalDailyLimit: s.options.GlobalDailyLimit, Session: store.Session{ID: id, UserID: uid, QuestionID: q.ID, Modality: q.Modality, Track: q.Track, PackID: req.PackID, PackRoundID: req.RoundID, Config: req.Config, DurationMinutes: req.Minutes, Funding: req.Funding, Mode: req.Mode, Provider: req.Provider, Model: req.Model, LiveModel: s.options.LiveModel, QuestionSnapshot: snapshot}, Identity: llm.UsageIdentity(s.options.EncryptionKey, u.Email), Unlimited: !s.options.Hosted || u.Role == "admin", Credential: encrypted, CredentialExpires: time.Now().Add(3 * time.Hour)})
	if err != nil {
		switch {
		case errors.Is(err, store.ErrQuota):
			httpx.WriteProblem(w, 429, "Your interview allowance is used. Check the next available time, use your own key when eligible, or run locally.")
		case errors.Is(err, store.ErrSessionConflict):
			httpx.WriteProblem(w, 409, "Resume or finish your existing interview before starting another.")
		default:
			httpx.WriteProblem(w, 503, "Could not reserve the interview. No allowance was used.")
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, sess)
}

// withRoundFocus merges a `round_focus` string into the session config JSON so
// the live director can specialize the interview for a pack round.
func withRoundFocus(cfg json.RawMessage, focus string) json.RawMessage {
	m := map[string]json.RawMessage{}
	if len(cfg) > 0 {
		_ = json.Unmarshal(cfg, &m)
	}
	b, _ := json.Marshal(focus)
	m["round_focus"] = b
	out, err := json.Marshal(m)
	if err != nil {
		return cfg
	}
	return out
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	var err error
	sess.Workspace, err = s.store.GetArtifact(r.Context(), sess.ID)
	if err != nil {
		httpx.WriteProblem(w, 503, "Saved workspace temporarily unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sess)
}

type turnReq struct {
	Role    string `json:"role"`
	Text    string `json:"text"`
	TsMs    int64  `json:"ts_ms"`
	EventID string `json:"event_id"`
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
	if req.Role != "candidate" {
		httpx.WriteProblem(w, http.StatusBadRequest, "only candidate turns may be submitted")
		return
	}
	if sess.Status != "active" && sess.Status != "interrupted" && sess.Status != "created" {
		httpx.WriteProblem(w, 409, "interview is not accepting answers")
		return
	}
	if strings.TrimSpace(req.Text) == "" || len(req.Text) > 24000 || len(req.EventID) > 128 {
		httpx.WriteProblem(w, 400, "Answer must contain 1–24000 bytes and a valid event ID")
		return
	}
	meta, _ := json.Marshal(map[string]string{"event_id": req.EventID})
	if err := s.store.AddTurn(r.Context(), sess.ID, req.Role, req.Text, req.TsMs, meta); err != nil && !errors.Is(err, store.ErrDuplicateEvent) {
		httpx.WriteProblem(w, http.StatusServiceUnavailable, "save failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type workspaceReq struct {
	Revision int64           `json:"revision"`
	Data     json.RawMessage `json:"data"`
	Kind     string          `json:"kind"` // code|written|note
	Content  string          `json:"content"`
	TsMs     int64           `json:"ts_ms"`
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
	artifact, err := s.store.SaveArtifact(r.Context(), sess.ID, store.Workspace{Kind: req.Kind, Content: req.Content, Revision: req.Revision, Data: req.Data})
	if err != nil {
		status := 503
		if errors.Is(err, store.ErrSessionConflict) {
			status = 409
		}
		httpx.WriteProblem(w, status, "Workspace could not be saved. Reload the latest revision and retry.")
		return
	}
	httpx.WriteJSON(w, 200, artifact)
}

// Finish scores the session and persists a report.
func (s *Service) Finish(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	if sess.Status == "complete" {
		httpx.WriteJSON(w, 200, map[string]string{"status": "complete"})
		return
	}
	if err := s.store.BeginFinish(r.Context(), sess.ID); err != nil {
		httpx.WriteProblem(w, 503, "Could not queue feedback. Your interview remains saved; retry finishing.")
		return
	}
	s.Wake()
	httpx.WriteJSON(w, 202, map[string]string{"status": "scoring"})
}

// isTransient reports whether a scoring error is worth retrying — a timeout,
// context deadline, or an upstream "temporarily unavailable"/rate-limit blip.
// Deterministic failures (e.g. a malformed model response we couldn't parse)
// are NOT transient: a retry would fail identically, so we skip it.
func isTransient(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, s := range []string{"timeout", "deadline", "temporarily", "unavailable", "connection reset", "eof", "429", "rate limit", "overloaded", "503", "502"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// Transcript returns the session's conversation so far so a resumed interview
// can reload the chat where the candidate left off.
func (s *Service) Transcript(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	turns, err := s.store.Transcript(r.Context(), sess.ID)
	if err != nil {
		httpx.WriteProblem(w, 503, "Transcript temporarily unavailable")
		return
	}
	out := make([]map[string]any, 0, len(turns))
	for _, t := range turns {
		role := "interviewer"
		if t.Role == "candidate" {
			role = "candidate"
		}
		out = append(out, map[string]any{"role": role, "text": t.Text, "ts_ms": t.TsMs, "id": t.ID, "sequence": t.Sequence, "event_id": t.EventID})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Report assembles the client-facing report from stored scores + report row.
func (s *Service) Report(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	if sess.Status == "scoring" || sess.Status == "ending" || sess.Status == "feedback_failed" {
		s.Wake()
		httpx.WriteJSON(w, 202, map[string]string{"status": mapStatus(sess.Status), "error": processingMessage(sess.Status)})
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
	workspace, workErr := s.store.LatestWorkspace(r.Context(), sess.ID)
	if workErr != nil {
		httpx.WriteProblem(w, 503, "Saved workspace temporarily unavailable")
		return
	}

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
		if errors.Is(err, store.ErrNotFound) {
			httpx.WriteProblem(w, 404, "session not found")
		} else {
			httpx.WriteProblem(w, 503, "Saved interview temporarily unavailable")
		}
		return store.Session{}, false
	}
	if sess.UserID != auth.UserID(r.Context()) {
		httpx.WriteProblem(w, http.StatusForbidden, "not your session")
		return store.Session{}, false
	}
	return sess, true
}
