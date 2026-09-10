package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/llm"
)

func TestHealthAliasesRemainLiveDuringDependencyFailure(t *testing.T) {
	r := chi.NewRouter()
	registerHealthRoutes(r, &config.Config{Environment: "production"}, llm.NewStub(), func(context.Context) error {
		t.Fatal("liveness must not depend on database availability")
		return nil
	})
	for _, path := range []string{"/health", "/healthz"} {
		res := httptest.NewRecorder()
		r.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		var body struct{ OK bool }
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil || res.Code != http.StatusOK || !body.OK {
			t.Fatalf("%s: status=%d body=%s error=%v", path, res.Code, res.Body.String(), err)
		}
	}
}

func TestReadinessAliases(t *testing.T) {
	for _, tc := range []struct {
		name, environment, dependency string
		databaseError                 error
		status                        int
	}{
		{name: "healthy", environment: "development", status: http.StatusOK},
		{name: "database unavailable", databaseError: errors.New("private connection details"), dependency: "database", status: http.StatusServiceUnavailable},
		{name: "production demo forbidden", environment: "production", dependency: "model_configuration", status: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := chi.NewRouter()
			checks := 0
			registerHealthRoutes(r, &config.Config{Environment: tc.environment, ReleaseSHA: "test-release"}, llm.NewStub(), func(ctx context.Context) error {
				checks++
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) > 3*time.Second {
					t.Fatal("database readiness check must have a bounded deadline")
				}
				return tc.databaseError
			})
			for _, path := range []string{"/ready", "/readyz"} {
				res := httptest.NewRecorder()
				r.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
				var body struct {
					Ready      bool
					Dependency string
					Release    string
				}
				if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil || res.Code != tc.status || body.Ready != (tc.status == http.StatusOK) || body.Dependency != tc.dependency {
					t.Fatalf("%s: status=%d body=%s error=%v", path, res.Code, res.Body.String(), err)
				}
				if body.Ready && body.Release != "test-release" {
					t.Fatalf("%s: missing release identity", path)
				}
			}
			if checks != 2 {
				t.Fatalf("each readiness alias must check the database; got %d checks", checks)
			}
		})
	}
}
