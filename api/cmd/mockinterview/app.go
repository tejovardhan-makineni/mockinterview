package main

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/interview"
	"github.com/tejo/mockinterview-api/internal/live"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/profile"
	"github.com/tejo/mockinterview-api/internal/resume"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
)

// App wires shared dependencies into the HTTP handlers. Feature handlers are
// mounted in Routes; each phase of the build adds its sub-router here.
type App struct {
	Cfg    *config.Config
	Store  store.Datastore
	LLM    llm.Client
	Corpus *corpus.Catalog
}

// Routes mounts all /api/v1 endpoints.
func (a *App) Routes(r chi.Router) {
	authSvc := auth.New(a.Store, a.Cfg.JWTSecret, a.Cfg.JWTTTL)

	r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, 200, map[string]string{"pong": "ok"})
	})

	// Per-user limiter for paid LLM/TTS endpoints (keyed by the authenticated
	// user id, so one account can't loop them to burn tokens).
	perUser := httprate.Limit(30, time.Hour, httprate.WithKeyFuncs(func(req *http.Request) (string, error) {
		return auth.UserID(req.Context()), nil
	}))

	// Public auth endpoints. register/login are throttled per-IP to blunt brute
	// force / spam; /me is NOT throttled — it's called on every page load, so a
	// limit there would spuriously "log the user out" during normal navigation.
	authLimit := httprate.LimitByIP(30, time.Minute)
	r.Route("/auth", func(r chi.Router) {
		r.With(authLimit).Post("/register", authSvc.Register)
		r.With(authLimit).Post("/login", authSvc.Login)
		r.With(authSvc.Required).Get("/me", authSvc.Me)
	})

	// Live interview WebSocket relay. Auth is via ?token= (WS can't set headers),
	// so it sits outside the bearer-header middleware group.
	relay := live.NewRelay(a.Store, a.Corpus, a.LLM, a.Cfg.GeminiAPIKey, a.Cfg.ModelLive, a.Cfg.LLMModel, authSvc.AuthFromRequest)
	r.Get("/sessions/{id}/live", relay.Handle)

	resumeSvc := resume.New(a.Store, a.LLM, a.Cfg.LLMModel)
	profileSvc := profile.New(a.Store, a.Cfg.GeminiAPIKey, a.Cfg.ModelTTS)
	corpusSvc := corpus.NewService(a.Corpus)
	scorer := scoring.New(a.LLM, a.Cfg.LLMModel)
	interviewSvc := interview.New(a.Store, a.Corpus, scorer, a.Cfg.AdminEmails, a.Cfg.FreeDailyLimit)

	// Authenticated API. Feature sub-routers are mounted here phase by phase.
	r.Group(func(r chi.Router) {
		r.Use(authSvc.Required)

		// Short-lived ticket to open the interview WebSocket (keeps the long-lived
		// JWT out of the WS URL).
		r.Get("/ws-ticket", authSvc.WSTicket)

		// Resume upload / parse / review. Review calls the LLM, so it's per-user
		// rate-limited.
		r.Post("/resume", resumeSvc.Upload)
		r.Get("/resume", resumeSvc.Get)
		r.With(perUser).Post("/resume/review", resumeSvc.Review)
		r.With(perUser).Post("/resume/match", resumeSvc.Match)

		// Interviewer configuration + catalogs.
		r.Get("/config", profileSvc.Get)
		r.Put("/config", profileSvc.Save)
		r.Get("/voices", profileSvc.ListVoices)
		r.With(perUser).Get("/voices/preview", profileSvc.PreviewVoice) // TTS costs money
		r.Get("/faces", profileSvc.ListFaces)
		r.Get("/personalities", profileSvc.ListPersonalities)

		// User profile + account deletion.
		r.Get("/profile", profileSvc.GetProfile)
		r.Put("/profile", profileSvc.SaveProfile)
		r.Delete("/account", profileSvc.DeleteAccount)

		// Question corpus (client-safe summaries).
		r.Get("/questions", corpusSvc.List)
		r.Get("/questions/{id}", corpusSvc.Get)

		// Interview sessions + scoring + report.
		r.Get("/sessions", interviewSvc.List)
		r.Post("/sessions", interviewSvc.Create)
		r.Get("/sessions/{id}", interviewSvc.Get)
		r.Post("/sessions/{id}/turns", interviewSvc.AddTurn)
		r.Post("/sessions/{id}/workspace", interviewSvc.SaveWorkspace)
		r.Post("/sessions/{id}/behavior", interviewSvc.Ingest)
		r.Post("/sessions/{id}/finish", interviewSvc.Finish)
		r.Get("/sessions/{id}/transcript", interviewSvc.Transcript)
		r.Get("/sessions/{id}/report", interviewSvc.Report)
	})
}
