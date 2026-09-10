package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/llm"
)

// Cloud Run may present shared edge addresses as RemoteAddr. Bound authentication
// by authenticated account/email or action-token digest instead of collapsing
// every user into one proxy-IP bucket. A loose process-wide ceiling bounds work
// from continually changing identities. Forwarded client-IP headers are ignored.
func authRateLimit(secret string) func(http.Handler) http.Handler {
	identityLimit := httprate.Limit(10, time.Minute, httprate.WithKeyFuncs(func(r *http.Request) (string, error) {
		key := auth.UserID(r.Context())
		if key == "" && r.Body != nil {
			data, err := io.ReadAll(io.LimitReader(r.Body, 8193))
			if err != nil {
				return "invalid", err
			}
			r.Body = io.NopCloser(bytes.NewReader(data))
			if len(data) > 8192 {
				return "oversized", nil
			}
			var fields struct {
				Email string `json:"email"`
				Token string `json:"token"`
			}
			_ = json.Unmarshal(data, &fields)
			if fields.Email != "" {
				key = llm.UsageIdentity([]byte(secret), fields.Email)
			} else if fields.Token != "" {
				sum := sha256.Sum256([]byte(fields.Token))
				key = hex.EncodeToString(sum[:])
			}
		}
		if key == "" {
			key = "invalid"
		}
		return r.URL.Path + ":" + strings.TrimSpace(key), nil
	}))
	globalLimit := httprate.Limit(600, time.Minute, httprate.WithKeyFuncs(func(*http.Request) (string, error) { return "auth-global", nil }))
	return chi.Chain(globalLimit, identityLimit).Handler
}
