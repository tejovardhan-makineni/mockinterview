package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"sync"

	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

var desktopBootstrapMu sync.Mutex

// DesktopBootstrap is mounted only by the desktop composition root, behind its
// per-launch bridge secret and loopback-only listener. It creates one local
// profile without a cloud account, email delivery or a reusable password.
func (s *Service) DesktopBootstrap(w http.ResponseWriter, r *http.Request) {
	if s.options.RequireVerification || s.options.RequirePolicies || !s.options.Development {
		http.NotFound(w, r)
		return
	}
	desktopBootstrapMu.Lock()
	defer desktopBootstrapMu.Unlock()
	u, err := s.store.UserByEmail(r.Context(), "local@mockinterview.invalid")
	if errors.Is(err, store.ErrNotFound) {
		secret := make([]byte, 32)
		if _, err = rand.Read(secret); err != nil {
			httpx.WriteProblem(w, 503, "Could not create local profile")
			return
		}
		hash, hashErr := s.hash(base64.RawURLEncoding.EncodeToString(secret))
		if hashErr != nil {
			httpx.WriteProblem(w, 503, "Could not create local profile")
			return
		}
		u, err = s.store.CreateUser(r.Context(), "local@mockinterview.invalid", hash)
	}
	if err != nil {
		httpx.WriteProblem(w, 503, "Local profile unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.respondAuth(w, u)
}
