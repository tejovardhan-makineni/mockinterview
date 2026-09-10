package interview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/persona"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
	"log/slog"
	"net/http"
	"time"
)

type Options struct {
	Hosted                          bool
	EncryptionKey                   []byte
	PlatformProvider, PlatformModel string
	LiveModel                       string
	GlobalDailyLimit                int
}

func (s *Service) SetOptions(o Options) {
	if !o.Hosted {
		o.GlobalDailyLimit = 0
	}
	s.options = o
}
func (s *Service) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// RunWorker is restart-safe: job leases expire in PostgreSQL after process loss.
// Production must allocate CPU outside requests; the same loop works locally.
func (s *Service) RunWorker(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	s.Wake()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
		}
		s.ProcessPending(ctx)
	}
}
func (s *Service) ProcessPending(ctx context.Context) {
	s.workerMu.Lock()
	defer s.workerMu.Unlock()
	for i := 0; i < 4 && ctx.Err() == nil; i++ {
		job, e := s.store.ClaimScoring(ctx)
		if errors.Is(e, store.ErrNotFound) {
			return
		}
		if e != nil {
			slog.Error("scoring claim unavailable")
			return
		}
		s.process(ctx, job)
	}
}
func (s *Service) process(parent context.Context, job store.ScoringJob) {
	ctx, cancel := context.WithTimeout(parent, 110*time.Second)
	defer cancel()
	e := s.scoreJob(ctx, job)
	if e != nil {
		if parent.Err() != nil {
			return
		}
		pctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		category, message := scoring.FailureDetails(e)
		if fail := s.store.FailScoring(pctx, job.SessionID, job.Attempts, message); fail != nil {
			slog.Error("scoring failure status unavailable", "session", job.SessionID)
		}
		slog.Warn("scoring attempt failed", "session", job.SessionID, "attempt", job.Attempts, "category", category)
	}
}
func (s *Service) scoreJob(ctx context.Context, job store.ScoringJob) error {
	sess, e := s.store.GetSession(ctx, job.SessionID)
	if e != nil {
		return e
	}
	var q corpus.Question
	if len(sess.QuestionSnapshot) > 2 {
		e = json.Unmarshal(sess.QuestionSnapshot, &q)
	} else {
		var ok bool
		q, ok = s.corpus.Get(sess.QuestionID)
		if !ok {
			return errors.New("missing question")
		}
	}
	if e != nil {
		return e
	}
	q = corpus.ApplySessionConfig(q, sess.Config)
	in := job.Input
	if in == nil {
		turns, e := s.store.Transcript(ctx, sess.ID)
		if e != nil {
			return e
		}
		work, e := s.store.LatestWorkspace(ctx, sess.ID)
		if e != nil {
			return e
		}
		behavior, e := s.store.BehavioralSummary(ctx, sess.ID)
		if e != nil {
			return e
		}
		raw, _ := json.Marshal(q)
		in = &store.ScoringInput{Question: raw, Config: sess.Config, Turns: turns, Workspace: work, Behavioral: behavior}
		if e = s.store.SetScoringInput(ctx, sess.ID, job.Attempts, *in); e != nil {
			return e
		}
	} else {
		if e = json.Unmarshal(in.Question, &q); e != nil {
			return e
		}
		q = corpus.ApplySessionConfig(q, in.Config)
	}
	engine := s.scorer
	if sess.Funding == "byok" {
		sealed, e := s.store.SessionCredential(ctx, sess.ID)
		if e != nil {
			return e
		}
		key, e := llm.OpenKey(s.options.EncryptionKey, sess.UserID, sess.ID, sealed)
		if e != nil {
			return e
		}
		client, e := llm.New(ctx, llm.Settings{Provider: llm.Provider(sess.Provider), Model: sess.Model, APIKey: key})
		if e != nil {
			return e
		}
		engine = scoring.New(client, sess.Model)
	}
	result, e := engine.Evaluate(ctx, q, in.Turns, in.Workspace)
	if e != nil && isTransient(e) && ctx.Err() == nil {
		result, e = engine.Evaluate(ctx, q, in.Turns, in.Workspace)
	}
	if e != nil {
		return e
	}
	collector := &reportCollector{}
	if e = engine.Persist(ctx, collector, sess.ID, result, in.Behavioral); e != nil {
		return e
	}
	return s.store.CompleteScoring(ctx, sess.ID, job.Attempts, collector.report, collector.rows)
}

type reportCollector struct {
	report store.Report
	rows   []store.ScoreRow
}

func (c *reportCollector) SaveScores(_ context.Context, _ string, rows []store.ScoreRow) error {
	c.rows = rows
	return nil
}
func (c *reportCollector) SaveReport(_ context.Context, _ string, overall float64, radar, timeline, behavioral json.RawMessage, coaching string, scored bool, note string) error {
	c.report = store.Report{Overall: overall, Radar: radar, Timeline: timeline, Behavioral: behavioral, CoachingMD: coaching, Scored: scored, Note: note}
	return nil
}
func mapStatus(st string) string {
	if st == "ending" {
		return "scoring"
	}
	return st
}
func processingMessage(st string) string {
	if st == "feedback_failed" {
		return "Feedback could not be completed. Verify your key if needed and retry feedback."
	}
	return ""
}
func (s *Service) Usage(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	u, e := s.store.UserByID(r.Context(), uid)
	if e != nil {
		httpx.WriteProblem(w, 401, "account unavailable")
		return
	}
	usage, e := s.store.Usage(r.Context(), uid, llm.UsageIdentity(s.options.EncryptionKey, u.Email), !s.options.Hosted)
	if e != nil {
		httpx.WriteProblem(w, 503, "Allowance temporarily unavailable")
		return
	}
	httpx.WriteJSON(w, 200, usage)
}
func (s *Service) Delete(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	if e := s.store.DeleteSession(r.Context(), sess.ID); e != nil {
		httpx.WriteProblem(w, 409, "Finish or disconnect the interview before deleting it")
		return
	}
	w.WriteHeader(204)
}
func (s *Service) Providers(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, 200, []any{map[string]any{"id": "gemini", "modes": []string{"voice", "text"}, "model_purpose": "Text interviews and feedback", "live_model": s.options.LiveModel, "voice_note": "Voice uses the server-selected Gemini Live model with your personal key."}, map[string]any{"id": "openai", "modes": []string{"text"}}, map[string]any{"id": "anthropic", "modes": []string{"text"}}, map[string]any{"id": "deepseek", "modes": []string{"text"}}, map[string]any{"id": "xai", "modes": []string{"text"}}})
}

type providerReq struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Mode     string `json:"mode"`
	APIKey   string `json:"api_key"`
}

func (s *Service) ValidateProvider(w http.ResponseWriter, r *http.Request) {
	var req providerReq
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(s.options.EncryptionKey) != 32 {
		httpx.WriteProblem(w, 503, "Personal keys are not configured on this server")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	client, e := llm.ValidatePersonalKey(ctx, req.Provider, req.Model, req.Mode, req.APIKey)
	if e != nil {
		httpx.WriteProblem(w, 400, e.Error())
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"valid": true, "provider": req.Provider, "model": client.Info().Model, "mode": req.Mode})
}
func (s *Service) Credentials(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	if sess.Funding != "byok" || sess.Status == "complete" {
		httpx.WriteProblem(w, 409, "This attempt does not need a personal key")
		return
	}
	var req struct {
		APIKey string `json:"api_key"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if _, e := llm.ValidatePersonalKey(ctx, sess.Provider, sess.Model, sess.Mode, req.APIKey); e != nil {
		httpx.WriteProblem(w, 400, e.Error())
		return
	}
	b, e := llm.SealKey(s.options.EncryptionKey, sess.UserID, sess.ID, req.APIKey)
	if e == nil {
		e = s.store.SetSessionCredential(ctx, sess.ID, b, time.Now().Add(3*time.Hour))
	}
	if e != nil {
		httpx.WriteProblem(w, 503, "Could not save the session key")
		return
	}
	httpx.WriteJSON(w, 200, map[string]bool{"ok": true})
}
func validateConfig(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	var m map[string]json.RawMessage
	if e := json.Unmarshal(raw, &m); e != nil || m == nil {
		return nil, errors.New("configuration must be an object")
	}
	allowed := map[string]bool{"voice_id": true, "face_id": true, "personality": true, "intensity": true, "language": true, "target_level": true, "challenge": true, "practice_mode": true, "include_resume": true}
	for k, v := range m {
		if !allowed[k] || len(v) > 2000 {
			return nil, fmt.Errorf("unsupported interview setting: %s", k)
		}
	}
	for k, values := range map[string][]string{"target_level": {"entry", "junior", "mid", "senior", "staff"}, "challenge": {"foundation", "standard", "stretch"}, "practice_mode": {"simulation", "coaching"}} {
		if v, ok := m[k]; ok {
			var a string
			if json.Unmarshal(v, &a) != nil {
				return nil, fmt.Errorf("invalid %s", k)
			}
			valid := false
			for _, want := range values {
				if a == want {
					valid = true
				}
			}
			if !valid {
				return nil, fmt.Errorf("invalid %s", k)
			}
		}
	}
	if raw, ok := m["include_resume"]; ok {
		var included bool
		if json.Unmarshal(raw, &included) != nil {
			return nil, errors.New("include_resume must be true or false")
		}
	}
	for k, valid := range map[string]func(string) bool{"voice_id": persona.ValidVoice, "face_id": persona.ValidFace, "personality": persona.ValidPersonality, "language": persona.ValidLanguage} {
		if v, ok := m[k]; ok {
			var value string
			if json.Unmarshal(v, &value) != nil || !valid(value) {
				return nil, fmt.Errorf("invalid %s", k)
			}
		}
	}
	if raw, ok := m["intensity"]; ok {
		var v int
		if json.Unmarshal(raw, &v) != nil || v < 1 || v > 5 {
			return nil, errors.New("intensity must be 1–5")
		}
	}
	return json.Marshal(m)
}
