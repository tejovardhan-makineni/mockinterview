package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/feedback"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/i18n"
	"github.com/tejo/mockinterview-api/internal/interview"
	"github.com/tejo/mockinterview-api/internal/live"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/pack"
	"github.com/tejo/mockinterview-api/internal/profile"
	"github.com/tejo/mockinterview-api/internal/resume"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
)

// App wires shared dependencies into the HTTP handlers. Feature handlers are
// mounted in Routes; each phase of the build adds its sub-router here.
type App struct {
	Background context.Context
	Cfg        *config.Config
	Store      store.Datastore
	LLM        llm.Client
	Corpus     *corpus.Catalog
	Packs      *pack.Catalog // practice packs; nil disables the packs feature (e.g. in tests)
}

// Routes mounts all /api/v1 endpoints.
func (a *App) Routes(r chi.Router) {
	authSvc := auth.New(a.Store, a.Cfg.JWTSecret, a.Cfg.JWTTTL)
	var mailer auth.Mailer
	if a.Cfg.ResendAPIKey != "" {
		mailer = auth.ResendMailer{APIKey: a.Cfg.ResendAPIKey, From: a.Cfg.MailFrom}
	} else if a.Cfg.SMTPAddress != "" {
		mailer = auth.SMTPMailer{Address: a.Cfg.SMTPAddress, Username: a.Cfg.SMTPUsername, Password: a.Cfg.SMTPPassword, From: a.Cfg.MailFrom, AllowLocalPlaintext: a.Cfg.Environment != "production"}
	}
	authSvc.Configure(auth.Options{PublicURL: a.Cfg.PublicURL, Mailer: mailer, RequireVerification: a.Cfg.Hosted, RequirePolicies: a.Cfg.Hosted, Development: !a.Cfg.Hosted})
	r.Get("/legal-policy", authSvc.LegalPolicy)

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
	authLimit := authRateLimit(a.Cfg.JWTSecret)
	r.Route("/auth", func(r chi.Router) {
		r.With(authLimit).Post("/register", authSvc.Register)
		r.With(authLimit).Post("/login", authSvc.Login)
		r.With(authSvc.Required).Get("/me", authSvc.Me)
		r.With(authLimit).Post("/verify", authSvc.Verify)
		r.With(authLimit).Post("/password/forgot", authSvc.ForgotPassword)
		r.With(authLimit).Post("/password/reset", authSvc.ResetPassword)
		r.With(authSvc.Required, authLimit).Post("/verification/resend", authSvc.ResendVerification)
		r.With(authSvc.Required, authLimit).Post("/password/change", authSvc.ChangePassword)
		r.With(authSvc.Required).Post("/logout", authSvc.Logout)
		r.With(authSvc.Required, authLimit).Post("/policies", authSvc.AcceptPolicies)
	})

	// Live interview WebSocket relay. Auth is via ?token= (WS can't set headers),
	// so it sits outside the bearer-header middleware group.
	relay := live.NewRelay(a.Store, a.Corpus, a.LLM, a.Cfg.GeminiAPIKey, a.Cfg.ModelLive, a.Cfg.LLMModel, a.Cfg.CORSAllow, authSvc.AuthFromRequest)
	r.Get("/sessions/{id}/live", relay.Handle)

	resumeSvc := resume.New(a.Store, a.LLM, a.Cfg.LLMModel)
	profileSvc := profile.New(a.Store, a.Cfg.GeminiAPIKey, a.Cfg.ModelTTS)
	corpusSvc := corpus.NewService(a.Corpus)
	feedbackSvc := feedback.New(a.Store, a.Cfg.AdminEmails)
	i18nSvc := i18n.New(a.LLM, a.Cfg.LLMModel)
	scorer := scoring.New(a.LLM, a.Cfg.LLMModel)
	interviewSvc := interview.New(a.Store, a.Corpus, scorer, a.Cfg.AdminEmails, a.Cfg.FreeDailyLimit)
	encryptionKey, _ := base64.StdEncoding.DecodeString(a.Cfg.SessionEncryptionKey)
	if len(encryptionKey) != 32 {
		encryptionKey = make([]byte, 32)
		if _, err := rand.Read(encryptionKey); err != nil {
			panic("session encryption initialization failed")
		}
	}
	interviewSvc.SetOptions(interview.Options{Hosted: a.Cfg.Hosted, EncryptionKey: encryptionKey, PlatformProvider: a.Cfg.LLMProvider, PlatformModel: a.Cfg.LLMModel, GlobalDailyLimit: a.Cfg.HostedDailyStartLimit, LiveModel: a.Cfg.ModelLive})
	relay.SetOptions(a.Cfg.Hosted, encryptionKey)
	if a.Background != nil {
		relay.SetContext(a.Background)
		go interviewSvc.RunWorker(a.Background)
	}

	// Practice packs (company/goal loops). Optional: nil catalog → feature off.
	var packSvc *pack.Service
	if a.Packs != nil {
		packSvc = pack.NewService(a.Corpus, a.Packs, a.Store)
		interviewSvc.SetPacks(packSvc) // resolve pack rounds → question + focus
	}

	// Public catalogs contain candidate-facing summaries only; answer keys stay server-side.
	r.Get("/questions", corpusSvc.List)
	r.Get("/questions/{id}", corpusSvc.Get)
	r.Get("/professions", corpusSvc.ListProfessions)
	r.Get("/languages", i18nSvc.ListLanguages)
	if packSvc != nil {
		r.Get("/packs", packSvc.List)
		r.Get("/packs/{id}", packSvc.Get)
	}

	// Authenticated API. Feature sub-routers are mounted here phase by phase.
	r.Group(func(r chi.Router) {
		r.Use(authSvc.Required)

		// Short-lived ticket to open the interview WebSocket (keeps the long-lived
		// JWT out of the WS URL).
		r.With(authSvc.Verified, authSvc.Eligible).Get("/ws-ticket", authSvc.WSTicket)

		// Upload also calls the LLM for parsing, so every paid resume action
		// requires verification and the shared per-user rate limit.
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Post("/resume", resumeSvc.Upload)
		r.Get("/resume", resumeSvc.Get)
		r.Delete("/resume", resumeSvc.Delete)
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Post("/resume/review", resumeSvc.Review)
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Post("/resume/match", resumeSvc.Match)

		// Interviewer configuration + catalogs.
		r.Get("/config", profileSvc.Get)
		r.Put("/config", profileSvc.Save)
		r.Get("/voices", profileSvc.ListVoices)
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Get("/voices/preview", profileSvc.PreviewVoice) // TTS costs money
		r.Get("/faces", profileSvc.ListFaces)
		r.Get("/personalities", profileSvc.ListPersonalities)

		// UI localization: list languages + translate app-owned strings (LLM,
		// per-user rate-limited; the client caches heavily so this is rare).
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Post("/i18n/translate", i18nSvc.Translate)

		// User profile + account deletion.
		r.Get("/profile", profileSvc.GetProfile)
		r.Put("/profile", profileSvc.SaveProfile)
		r.Delete("/account", profileSvc.DeleteAccount)
		r.Get("/account/export", profileSvc.ExportAccount)

		// Question corpus (client-safe summaries).

		// Professions (corpus areas) — drives catalog gating + onboarding picker.

		// User feedback (general or in-interview with debug context). Submit is
		// rate-limited to curb spam; List is admin-gated inside the handler.
		r.With(perUser).Post("/feedback", feedbackSvc.Submit)
		r.Get("/feedback", feedbackSvc.List)
		r.Patch("/feedback/{id}", feedbackSvc.Triage)

		// Practice packs (company/goal interview loops) + per-user progress.
		if packSvc != nil {
			r.Get("/packs/{id}/progress", packSvc.Progress)
		}

		// Interview sessions + scoring + report.
		r.Get("/usage", interviewSvc.Usage)
		r.Get("/providers", interviewSvc.Providers)
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Post("/providers/validate", interviewSvc.ValidateProvider)
		r.With(authSvc.Verified, authSvc.Eligible, perUser).Put("/sessions/{id}/credentials", interviewSvc.Credentials)
		r.Delete("/sessions/{id}", interviewSvc.Delete)
		r.Get("/sessions", interviewSvc.List)
		r.With(authSvc.Verified, authSvc.Eligible).Post("/sessions", interviewSvc.Create)
		r.Get("/sessions/{id}", interviewSvc.Get)
		r.Post("/sessions/{id}/turns", interviewSvc.AddTurn)
		r.Post("/sessions/{id}/workspace", interviewSvc.SaveWorkspace)
		r.Post("/sessions/{id}/behavior", interviewSvc.Ingest)
		r.With(authSvc.Verified, authSvc.Eligible).Post("/sessions/{id}/finish", interviewSvc.Finish)
		r.Get("/sessions/{id}/transcript", interviewSvc.Transcript)
		r.Get("/sessions/{id}/report", interviewSvc.Report)
	})
}
