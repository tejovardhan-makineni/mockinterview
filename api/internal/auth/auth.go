// Package auth provides self-contained email/password authentication with JWT
// sessions — no external identity provider, so the app runs with only a Gemini
// key. A Firebase verifier can be added later behind the same middleware.
package auth

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

type ctxKey string

const userIDKey ctxKey = "uid"
const tokenVersionKey ctxKey = "token_version"

// Repo is the persistence auth needs. *store.Store satisfies it; tests supply a
// fake. Declaring it consumer-side keeps auth independent of the concrete store.
type Repo interface {
	CreateUser(ctx context.Context, email, passwordHash string) (store.User, error)
	UserByEmail(ctx context.Context, email string) (store.User, error)
	UserByID(ctx context.Context, id string) (store.User, error)
}

type Service struct {
	store   Repo
	secret  []byte
	ttl     time.Duration
	options Options
}

func New(st Repo, secret string, ttl time.Duration) *Service {
	return &Service{store: st, secret: []byte(secret), ttl: ttl}
}

func (s *Service) hash(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

// Token audiences isolate the two token kinds so one can't be replayed as the
// other (SEC-5/GO-10). The full session JWT carries aud=api and is accepted only
// on bearer-header API requests; the short-lived WebSocket ticket carries aud=ws
// and is accepted only on the socket handshake. Without distinct audiences a 90s
// ws ticket (which rides in a URL/log) would also be a valid full API bearer.
const (
	apiAudience = "api"
	wsAudience  = "ws"
)

type sessionClaims struct {
	jwt.RegisteredClaims
	Version int `json:"ver"`
}

var ErrUnavailable = errors.New("authentication storage unavailable")

func (s *Service) issueAudience(userID, audience string, ttl time.Duration) (string, error) {
	version := 0
	if s.store != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		u, err := s.store.UserByID(ctx, userID)
		if err != nil {
			return "", ErrUnavailable
		}
		version = u.TokenVersion
	}
	return s.signAudience(userID, version, audience, ttl)
}

// Sign the identity version observed when the credential was authenticated.
// Rereading a newer version here would revive a concurrently revoked session.
func (s *Service) signAudience(userID string, version int, audience string, ttl time.Duration) (string, error) {
	claims := sessionClaims{RegisteredClaims: jwt.RegisteredClaims{Subject: userID, Audience: jwt.ClaimStrings{audience}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)), IssuedAt: jwt.NewNumericDate(time.Now())}, Version: version}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}
func (s *Service) issue(userID string) (string, error) {
	return s.issueAudience(userID, apiAudience, s.ttl)
}
func (s *Service) issueTicket(userID string) (string, error) {
	return s.issueAudience(userID, wsAudience, 90*time.Second)
}
func (s *Service) keyFunc(t *jwt.Token) (any, error) {
	if t.Method != jwt.SigningMethodHS256 {
		return nil, errors.New("unexpected signing method")
	}
	return s.secret, nil
}
func (s *Service) parseAudience(tokenStr, audience string) (string, error) {
	claims, err := s.parseAudienceClaims(tokenStr, audience)
	if err != nil {
		return "", err
	}
	return claims.Subject, nil
}

func (s *Service) parseAudienceClaims(tokenStr, audience string) (*sessionClaims, error) {
	claims := &sessionClaims{}
	tok, err := jwt.ParseWithClaims(tokenStr, claims, s.keyFunc, jwt.WithAudience(audience), jwt.WithExpirationRequired(), jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuedAt())
	if err != nil || !tok.Valid || claims.Subject == "" {
		return nil, errors.New("invalid token")
	}
	if s.store != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		u, err := s.store.UserByID(ctx, claims.Subject)
		if errors.Is(err, store.ErrNotFound) {
			return nil, errors.New("account unavailable")
		}
		if err != nil {
			return nil, ErrUnavailable
		}
		if u.TokenVersion != claims.Version {
			return nil, errors.New("session revoked")
		}
	}
	return claims, nil
}
func (s *Service) parseTicket(tokenStr string) (string, error) {
	return s.parseAudience(tokenStr, wsAudience)
}
func (s *Service) parse(tokenStr string) (string, error) {
	return s.parseAudience(tokenStr, apiAudience)
}

// ---- HTTP handlers ----

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registration struct {
	credentials
	policyAssertion
}

type authResponse struct {
	Token string      `json:"token"`
	User  userPayload `json:"user"`
}

type userPayload struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email"`
	EmailVerified      bool       `json:"email_verified"`
	Role               string     `json:"role"`
	AdultConfirmed     bool       `json:"adult_confirmed"`
	PoliciesRequired   bool       `json:"policies_required"`
	TermsVersion       string     `json:"terms_version"`
	PrivacyVersion     string     `json:"privacy_version"`
	PoliciesAcceptedAt *time.Time `json:"policies_accepted_at,omitempty"`
	AdultConfirmedAt   *time.Time `json:"adult_confirmed_at,omitempty"`
}

func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	var c registration
	if !httpx.DecodeJSON(w, r, &c) {
		return
	}
	if s.options.RequirePolicies && !c.current() {
		PolicyRequired(w)
		return
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	address, emailErr := mail.ParseAddress(c.Email)
	if emailErr != nil || address.Address != c.Email || len(c.Email) > 254 || !validPassword(c.Password) {
		httpx.WriteProblem(w, http.StatusBadRequest, "valid email and password (12–72 bytes) required")
		return
	}
	if s.options.RequireVerification && s.options.Mailer == nil {
		httpx.WriteProblem(w, http.StatusServiceUnavailable, "account email delivery is not configured")
		return
	}
	if _, err := s.store.UserByEmail(r.Context(), c.Email); err == nil {
		httpx.WriteProblem(w, http.StatusConflict, "email already registered; sign in or reset your password")
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		httpx.WriteProblem(w, http.StatusServiceUnavailable, "account service unavailable")
		return
	}
	hash, err := s.hash(c.Password)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "hash failed")
		return
	}
	var u store.User
	if c.current() {
		repo, ok := s.store.(store.PolicyStore)
		if !ok {
			httpx.WriteProblem(w, 503, "account service unavailable")
			return
		}
		u, err = repo.CreateUserWithPolicies(r.Context(), c.Email, hash, c.TermsVersion, c.PrivacyVersion)
	} else {
		u, err = s.store.CreateUser(r.Context(), c.Email, hash)
	}
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "create failed")
		return
	}
	if s.options.RequireVerification || s.options.Development {
		extra := map[string]any{"verification_required": s.options.RequireVerification}
		link, err := s.sendAction(r.Context(), u, "verify")
		extra["delivery_available"] = err == nil
		if s.options.Development && link != "" {
			extra["development_action_url"] = link
		}
		s.respondAuthExtra(w, u, extra)
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
	httpx.WriteJSON(w, http.StatusOK, s.payload(u))
}

func (s *Service) payload(u store.User) userPayload {
	return userPayload{ID: u.ID, Email: u.Email, EmailVerified: u.EmailVerified, Role: u.Role,
		AdultConfirmed: u.AdultConfirmedAt != nil, PoliciesRequired: s.options.RequirePolicies && !PoliciesAccepted(u),
		TermsVersion: u.TermsVersion, PrivacyVersion: u.PrivacyVersion, PoliciesAcceptedAt: u.PoliciesAcceptedAt, AdultConfirmedAt: u.AdultConfirmedAt}
}
func (s *Service) respondAuth(w http.ResponseWriter, u store.User) { s.respondAuthExtra(w, u, nil) }
func (s *Service) respondAuthExtra(w http.ResponseWriter, u store.User, extra map[string]any) {
	token, err := s.signAudience(u.ID, u.TokenVersion, apiAudience, s.ttl)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "token failed")
		return
	}
	if extra == nil {
		extra = map[string]any{}
	}
	extra["token"] = token
	extra["user"] = s.payload(u)
	httpx.WriteJSON(w, http.StatusOK, extra)
}

// ---- Middleware ----

// Required rejects requests without a valid bearer token.
func (s *Service) Required(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, err := s.requestClaims(r)
		if err != nil {
			if errors.Is(err, ErrUnavailable) {
				httpx.WriteProblem(w, http.StatusServiceUnavailable, "account service unavailable")
				return
			}
			httpx.WriteProblem(w, http.StatusUnauthorized, "authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, claims.Subject)
		ctx = context.WithValue(ctx, tokenVersionKey, claims.Version)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// authFromRequest authenticates a normal HTTP request via the Authorization
// bearer header (the full session JWT).
func (s *Service) authFromRequest(r *http.Request) (string, error) {
	claims, err := s.requestClaims(r)
	if err != nil {
		return "", err
	}
	return claims.Subject, nil
}

func (s *Service) requestClaims(r *http.Request) (*sessionClaims, error) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return nil, errors.New("no token")
	}
	return s.parseAudienceClaims(strings.TrimPrefix(h, "Bearer "), apiAudience)
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
	version, ok := r.Context().Value(tokenVersionKey).(int)
	if !ok || UserID(r.Context()) == "" {
		httpx.WriteProblem(w, http.StatusUnauthorized, "authentication required")
		return
	}
	t, err := s.signAudience(UserID(r.Context()), version, wsAudience, 90*time.Second)
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
