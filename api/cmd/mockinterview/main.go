// Command mockinterview is the single API binary for the mock system-design
// interview platform. It serves the REST API and the Gemini Live WebSocket
// relay. It runs with only GEMINI_API_KEY (and a Postgres URL); with no key it
// uses the deterministic LLM stub so everything works offline.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
)

func main() {
	// Standalone corpus validation (used by authoring agents + CI). Loads a
	// directory, validates every question, exits non-zero on any error. No DB.
	validateDir := flag.String("validate-corpus", "", "validate all questions in this directory and exit")
	checkLLM := flag.Bool("check-llm", false, "run a tiny live call against every provider whose key is set, then exit")
	flag.Parse()
	if *validateDir != "" {
		cat, err := corpus.Load(*validateDir)
		if err != nil {
			fmt.Fprintln(os.Stderr, "INVALID:\n"+err.Error())
			os.Exit(1)
		}
		fmt.Printf("OK: %d questions valid in %s\n", cat.Count(), *validateDir)
		os.Exit(0)
	}
	if *checkLLM {
		runLLMCheck()
		os.Exit(0)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}

	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		slog.Error("store", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	ai, err := llm.New(ctx, llm.Settings{
		Provider:  llm.Provider(cfg.LLMProvider),
		APIKey:    cfg.LLMAPIKey,
		Model:     cfg.LLMModel,
		BaseURL:   cfg.LLMBaseURL,
		ForceStub: cfg.UseStubLLM,
	})
	if err != nil {
		slog.Error("llm", "err", err)
		os.Exit(1)
	}
	info := ai.Info()

	cat, err := corpus.Load(cfg.CorpusDir)
	if err != nil {
		slog.Error("corpus", "err", err)
		os.Exit(1)
	}
	slog.Info("startup", "mode", cfg.Mode, "llm_provider", info.Provider, "llm_model", info.Model, "llm_stub", ai.Stubbed(), "model_live", cfg.ModelLive, "questions", cat.Count())

	app := &App{Cfg: cfg, Store: st, LLM: ai, Corpus: cat}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllow,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "llm_stub": ai.Stubbed()})
	})

	r.Route("/api/v1", app.Routes)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("serve", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	slog.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}
