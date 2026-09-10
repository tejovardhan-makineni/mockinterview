package httpx

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Operational logs deliberately omit request bodies, query strings, identities,
// transcript text and credentials. The response ID can safely accompany reports.
func Observe(release string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Request-ID", middleware.GetReqID(r.Context()))
			w.Header().Set("X-Release", release)
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(wrapped, r)
			route := "unknown"
			if c := chi.RouteContext(r.Context()); c != nil {
				route = c.RoutePattern()
			}
			slog.Info("request", "request_id", middleware.GetReqID(r.Context()), "method", r.Method, "route", route, "status", wrapped.Status(), "duration_ms", time.Since(start).Milliseconds())
		})
	}
}

// A normal REST deadline must not cancel a long-lived upgraded interview.
func RESTTimeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		bounded := middleware.Timeout(d)(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
				next.ServeHTTP(w, r)
				return
			}
			bounded.ServeHTTP(w, r)
		})
	}
}
