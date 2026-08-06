// Package auth provides self-contained email/password authentication with JWT
// sessions — no external identity provider, so the app runs with only a Gemini
// key. A Firebase verifier can be added later behind the same middleware.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

type ctxKey string

const userIDKey ctxKey = "uid"

// Repo is the persistence auth needs. *store.Store satisfies it; tests supply a
// fake. Declaring it consumer-side keeps auth independent of the concrete store.
type Repo interface {
	CreateUser(ctx context.Context, email, passwordHash string) (store.User, error)
	UserByEmail(ctx context.Context, email string) (store.User, error)
	UserByID(ctx context.Context, id string) (store.User, error)
}

type Service struct {
	store  Repo
	secret []byte
	ttl    time.Duration
}

func New(st Repo, secret string, ttl time.Duration) *Service {
	return &Service{store: st, secret: []byte(secret), ttl: ttl}
}

func (s *Service) hash(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

// wsAudience marks a short-lived ticket that may ride in a WebSocket URL. The
// long-lived session JWT never carries it, so a JWT leaked from a URL/log is not
// accepted on the socket, and a ticket is useless after ~90s.
const wsAudience = "ws"

func (s *Service) issue(userID string) (string, error) {
	claims := jwt.RegisteredClaims{
		Subject:   userID,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.ttl)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}

// issueTicket mints a short-TTL, ws-audience token for the WebSocket handshake.
func (s *Service) issueTicket(userID string) (string, error) {
	claims := jwt.RegisteredClaims{
		Subject:   userID,
		Audience:  jwt.ClaimStrings{wsAudience},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(90 * time.Second)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}

func (s *Service) keyFunc(t *jwt.Token) (any, error) {
	if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, errors.New("unexpected signing method")
	}
	return s.secret, nil
}

// parseTicket validates a WebSocket ticket (must carry the ws audience).
func (s *Service) parseTicket(tokenStr string) (string, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, s.keyFunc, jwt.WithAudience(wsAudience))
	if err != nil || !tok.Valid {
		return "", errors.New("invalid ticket")
	}
	claims, ok := tok.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return "", errors.New("invalid ticket claims")
	}
	return claims.Subject, nil
}

func (s *Service) parse(tokenStr string) (string, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, s.keyFunc)
	if err != nil || !tok.Valid {
		return "", errors.New("invalid token")
	}
	claims, ok := tok.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return "", errors.New("invalid claims")
	}
	return claims.Subject, nil
}

// ---- HTTP handlers ----

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string      `json:"token"`
	User  userPayload `json:"user"`
}

type userPayload struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !httpx.DecodeJSON(w, r, &c) {
		return
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if !strings.Contains(c.Email, "@") || len(c.Password) < 6 {
		httpx.WriteProblem(w, http.StatusBadRequest, "valid email and password (min 6 chars) required")
		return
	}
	if _, err := s.store.UserByEmail(r.Context(), c.Email); err == nil {
		httpx.WriteProblem(w, http.StatusConflict, "email already registered")
		return
	}
	hash, err := s.hash(c.Password)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "hash failed")
		return
	}
	u, err := s.store.CreateUser(r.Context(), c.Email, hash)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "create failed")
		return
	}
	s.respondAuth(w, u)
}

func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if !httpx.DecodeJSON(w, r, &c) {
		return
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	u, err := s.store.UserByEmail(r.Context(), c.Email)
	if err != nil {
		httpx.WriteProblem(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(c.Password)) != nil {
		httpx.WriteProblem(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	s.respondAuth(w, u)
}

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	uid := UserID(r.Context())
	u, err := s.store.UserByID(r.Context(), uid)
	if err != nil {
		httpx.WriteProblem(w, http.StatusNotFound, "user not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, userPayload{ID: u.ID, Email: u.Email})
}

func (s *Service) respondAuth(w http.ResponseWriter, u store.User) {
	token, err := s.issue(u.ID)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "token failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, authResponse{Token: token, User: userPayload{ID: u.ID, Email: u.Email}})
}

// ---- Middleware ----

// Required rejects requests without a valid bearer token.
func (s *Service) Required(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, err := s.authFromRequest(r)
		if err != nil {
			httpx.WriteProblem(w, http.StatusUnauthorized, "authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, uid)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// authFromRequest authenticates a normal HTTP request via the Authorization
// bearer header (the full session JWT).
func (s *Service) authFromRequest(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return "", errors.New("no token")
	}
	return s.parse(strings.TrimPrefix(h, "Bearer "))
}

// AuthFromRequest authenticates a WebSocket upgrade. Browsers can't set headers
// on a WebSocket, so it accepts a short-lived ws TICKET via ?token= — never the
// long-lived session JWT — obtained from GET /ws-ticket. Exported for the relay.
func (s *Service) AuthFromRequest(r *http.Request) (string, error) {
	if q := r.URL.Query().Get("token"); q != "" {
		return s.parseTicket(q)
	}
	// Also allow a header (non-browser clients / tests).
	return s.authFromRequest(r)
}

// WSTicket issues a short-lived ticket for opening the interview WebSocket.
func (s *Service) WSTicket(w http.ResponseWriter, r *http.Request) {
	t, err := s.issueTicket(UserID(r.Context()))
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "could not issue ticket")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"ticket": t})
}

// UserID returns the authenticated user id from a request context.
func UserID(ctx context.Context) string {
	if v, ok := ctx.Value(userIDKey).(string); ok {
		return v
	}
	return ""
}
