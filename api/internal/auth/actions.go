package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type Mailer interface {
	Send(context.Context, string, string, string) error
}
type Options struct {
	PublicURL           string
	Mailer              Mailer
	RequireVerification bool
	Development         bool
}

func (s *Service) Configure(o Options) { s.options = o }
func validPassword(p string) bool      { return len(p) >= 12 && len(p) <= 72 }
func hashAction(token string) string {
	b := sha256.Sum256([]byte(token))
	return hex.EncodeToString(b[:])
}
func (s *Service) accounts() (store.AccountStore, error) {
	a, ok := s.store.(store.AccountStore)
	if !ok {
		return nil, ErrUnavailable
	}
	return a, nil
}

// Tokens are never stored or logged in plaintext. The action URL is returned only
// by explicit development mode, so a fresh clone needs no mail infrastructure.
func (s *Service) sendAction(ctx context.Context, u store.User, purpose string) (string, error) {
	repo, err := s.accounts()
	if err != nil {
		return "", err
	}
	tokenBytes := make([]byte, 32)
	if _, err = rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	expiry := time.Now().Add(30 * time.Minute)
	subject := "Reset your mockinterview password"
	if purpose == "verify" {
		expiry = time.Now().Add(24 * time.Hour)
		subject = "Verify your mockinterview email"
	}
	if err = repo.SaveAuthAction(ctx, u.ID, purpose, hashAction(token), expiry); err != nil {
		return "", err
	}
	link := strings.TrimRight(s.options.PublicURL, "/") + "/auth/action?" + url.Values{"action": {purpose}, "token": {token}}.Encode()
	if s.options.Mailer == nil {
		if s.options.Development {
			return link, nil
		}
		return "", errors.New("email delivery unavailable")
	}
	message := subject + "\n\nOpen this link to continue:\n" + link + "\n\nThe link expires at " + expiry.UTC().Format(time.RFC1123) + " and works once. If you did not request it, ignore this email."
	if err = s.options.Mailer.Send(ctx, u.Email, subject, message); err != nil {
		return "", err
	}
	return "", nil
}
func (s *Service) ResendVerification(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.UserByID(r.Context(), UserID(r.Context()))
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	if u.EmailVerified {
		httpx.WriteJSON(w, 200, map[string]string{"message": "Email is already verified."})
		return
	}
	link, err := s.sendAction(r.Context(), u, "verify")
	if errors.Is(err, store.ErrActionThrottled) {
		httpx.WriteProblem(w, 429, "Wait one minute before requesting another link.")
		return
	}
	if err != nil {
		httpx.WriteProblem(w, 503, "Verification email could not be sent. Please try again later.")
		return
	}
	out := map[string]any{"message": "Check your inbox and spam folder for the verification link."}
	if s.options.Development && link != "" {
		out["development_action_url"] = link
	}
	httpx.WriteJSON(w, 200, out)
}
func (s *Service) Verify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if !httpx.DecodeJSON(w, r, &body) {
		return
	}
	repo, err := s.accounts()
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	if _, err = repo.ConsumeAuthAction(r.Context(), hashAction(body.Token), "verify", ""); err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			httpx.WriteProblem(w, 503, "Verification is temporarily unavailable. Try this link again later.")
			return
		}
		httpx.WriteProblem(w, 400, "This link is expired or already used. Request a new verification email.")
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "Email verified. You can return to your interview setup."})
}
func (s *Service) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if !httpx.DecodeJSON(w, r, &body) {
		return
	}
	// Always the same external response: do not disclose whether an account exists.
	out := map[string]any{"message": "If this address has an account, a reset link will arrive shortly. Check your spam folder too."}
	if u, err := s.store.UserByEmail(r.Context(), strings.ToLower(strings.TrimSpace(body.Email))); err == nil {
		link, _ := s.sendAction(r.Context(), u, "reset")
		if s.options.Development && link != "" {
			out["development_action_url"] = link
		}
	}
	httpx.WriteJSON(w, 200, out)
}
func (s *Service) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !httpx.DecodeJSON(w, r, &body) {
		return
	}
	if !validPassword(body.Password) {
		httpx.WriteProblem(w, 400, "Use a password of 12–72 bytes.")
		return
	}
	hash, err := s.hash(body.Password)
	if err != nil {
		httpx.WriteProblem(w, 500, "could not update password")
		return
	}
	repo, err := s.accounts()
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	if _, err = repo.ConsumeAuthAction(r.Context(), hashAction(body.Token), "reset", hash); err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			httpx.WriteProblem(w, 503, "Password reset is temporarily unavailable. Try this link again later.")
			return
		}
		httpx.WriteProblem(w, 400, "This link is expired or already used. Request a new password reset.")
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "Password updated. Sign in with your new password. Other sessions have been signed out."})
}
func (s *Service) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current  string `json:"current_password"`
		Password string `json:"password"`
	}
	if !httpx.DecodeJSON(w, r, &body) {
		return
	}
	if !validPassword(body.Password) {
		httpx.WriteProblem(w, 400, "Use a password of 12–72 bytes.")
		return
	}
	u, err := s.store.UserByID(r.Context(), UserID(r.Context()))
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(body.Current)) != nil {
		httpx.WriteProblem(w, 400, "Current password is incorrect.")
		return
	}
	hash, err := s.hash(body.Password)
	if err != nil {
		httpx.WriteProblem(w, 500, "could not update password")
		return
	}
	repo, err := s.accounts()
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	if err = repo.ChangePassword(r.Context(), u.ID, u.PasswordHash, hash); err != nil {
		httpx.WriteProblem(w, 409, "Password changed elsewhere. Sign in again.")
		return
	}
	// The successful compare-and-swap increments this observed version once.
	// A concurrent reset/logout must leave the response token stale.
	u.TokenVersion++
	s.respondAuth(w, u)
}
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	repo, err := s.accounts()
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	if err = repo.RevokeSessions(r.Context(), UserID(r.Context())); err != nil {
		httpx.WriteProblem(w, 503, "could not sign out other sessions")
		return
	}
	w.WriteHeader(204)
}

// Verified gates features that incur model costs, while leaving account
// recovery, history, export and deletion accessible to unverified legacy users.
func (s *Service) Verified(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.options.RequireVerification {
			next.ServeHTTP(w, r)
			return
		}
		u, err := s.store.UserByID(r.Context(), UserID(r.Context()))
		if err != nil {
			httpx.WriteProblem(w, 503, "account service unavailable")
			return
		}
		if !u.EmailVerified {
			httpx.WriteProblem(w, 403, "Verify your email before using hosted AI features.")
			return
		}
		next.ServeHTTP(w, r)
	})
}
