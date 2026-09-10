package main

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/llm"
)

func registerHealthRoutes(r chi.Router, cfg *config.Config, ai llm.Client, ping func(context.Context) error) {
	health := func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "llm_stub": ai.Stubbed()})
	}
	ready := func(w http.ResponseWriter, r *http.Request) {
		check, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := ping(check); err != nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ready": false, "dependency": "database"})
			return
		}
		if cfg.Environment == "production" && ai.Stubbed() {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ready": false, "dependency": "model_configuration"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ready": true, "release": cfg.ReleaseSHA, "llm_stub": ai.Stubbed(), "provider": ai.Info().Provider})
	}
	// Use /health and /ready through Cloud Run's public frontend. Retain the
	// original paths for existing local clients and container probes.
	for _, path := range []string{"/health", "/healthz"} {
		r.Get(path, health)
	}
	for _, path := range []string{"/ready", "/readyz"} {
		r.Get(path, ready)
	}
}
