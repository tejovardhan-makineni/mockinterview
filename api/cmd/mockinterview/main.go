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
	"net"
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
	"github.com/tejo/mockinterview-api/internal/pack"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
	"github.com/tejo/mockinterview-api/internal/store/sqlitestore"
)

func main() {
	// Standalone corpus validation (used by authoring agents + CI). Loads a
	// directory, validates every question, exits non-zero on any error. No DB.
	validateDir := flag.String("validate-corpus", "", "validate all questions in this directory and exit")
	migrateOnly := flag.Bool("migrate-only", false, "apply pending migrations and exit")
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

	ctx, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	var st store.Datastore
	pingStore := func(context.Context) error { return nil }
	if cfg.LocalDesktop {
		database, openErr := sqlitestore.Open(ctx, cfg.DesktopDBPath)
		if openErr != nil {
			slog.Error("local database unavailable", "err", openErr)
			os.Exit(1)
		}
		defer database.Close()
		st, pingStore = database, database.Ping
		if *migrateOnly {
			slog.Info("local migrations complete")
			return
		}
		go database.Maintenance(ctx)
	} else if cfg.LocalMemory {
		if *migrateOnly {
			slog.Error("migrations require PostgreSQL; disable LOCAL_MEMORY")
			os.Exit(1)
		}
		st = memstore.New()
		slog.Warn("local demo storage is temporary; accounts and interviews reset when the API stops")
	} else {
		database, openErr := store.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
		if openErr != nil {
			slog.Error("store", "err", openErr)
			os.Exit(1)
		}
		defer database.Close()
		st = database
		pingStore = database.Pool.Ping
		if *migrateOnly {
			slog.Info("migrations complete")
			return
		}
		go database.Maintenance(ctx)
	}

	var ai llm.Client
	if cfg.LocalDesktop {
		ai = llm.DesktopClient{}
	} else {
		ai, err = llm.New(ctx, llm.Settings{
			Provider:  llm.Provider(cfg.LLMProvider),
			APIKey:    cfg.LLMAPIKey,
			Model:     cfg.LLMModel,
			BaseURL:   cfg.LLMBaseURL,
			ForceStub: cfg.UseStubLLM,
		})
	}
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
	packs, err := pack.Load(cfg.PacksDir, cat)
	if err != nil {
		slog.Error("packs", "err", err)
		os.Exit(1)
	}
	slog.Info("startup", "mode", cfg.Mode, "llm_provider", info.Provider, "llm_model", info.Model, "llm_stub", ai.Stubbed(), "model_live", cfg.ModelLive, "questions", cat.Count(), "packs", packs.Count())
	listenHost := os.Getenv("LISTEN_HOST")
	if cfg.LocalDesktop || cfg.LocalMemory || (listenHost == "" && cfg.Environment != "production") {
		listenHost = "127.0.0.1"
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(listenHost, cfg.Port))
	if err != nil {
		slog.Error("listener unavailable", "err", err)
		os.Exit(1)
	}
	defer listener.Close()
	if cfg.LocalDesktop {
		cfg.PublicURL = "http://" + listener.Addr().String()
		cfg.CORSAllow = []string{cfg.PublicURL}
	}

	app := &App{Background: ctx, Cfg: cfg, Store: st, LLM: ai, Corpus: cat, Packs: packs}

	r := chi.NewRouter()
	if cfg.LocalDesktop {
		r.Use(desktopBridge(cfg.DesktopBridgeToken, listener.Addr().String()))
		r.Use(llm.DesktopCredentials)
	}
	r.Use(middleware.RequestID)
	// Do not trust arbitrary X-Real-IP/True-Client-IP headers for auth limits.
	r.Use(middleware.Recoverer)
	r.Use(httpx.Observe(cfg.ReleaseSHA))
	r.Use(httpx.RESTTimeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllow,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		ExposedHeaders:   []string{"X-Request-ID", "X-Release"},
		MaxAge:           300,
	}))

	registerHealthRoutes(r, cfg, ai, pingStore)
	r.Route("/api/v1", app.Routes)
	if cfg.LocalDesktop {
		r.Handle("/desktop/remote/*", desktopRemoteProxy())
		r.Handle("/*", desktopAssets(cfg.DesktopWebDir))
	}
	srv := &http.Server{
		Addr:              listenHost + ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("listening", "addr", srv.Addr)
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("serve", "err", err)
			os.Exit(1)
		}
	}()
	if cfg.LocalDesktop {
		slog.Info("desktop_ready", "url", cfg.PublicURL)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	slog.Info("shutting down")
	stopWorkers()
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}
