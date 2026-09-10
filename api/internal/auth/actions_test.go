package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestEmailActionsSingleUseAndResetRevokesSessions(t *testing.T) {
	st := memstore.New()
	s := New(st, "test-secret", time.Hour)
	s.Configure(Options{PublicURL: "http://localhost:3000", Development: true})
	hash, _ := s.hash("long old password")
	u, err := st.CreateUser(context.Background(), "person@example.com", hash)
	if err != nil {
		t.Fatal(err)
	}
	tok, _ := s.issue(u.ID)
	ticket, _ := s.issueTicket(u.ID)
	link, err := s.sendAction(context.Background(), u, "verify")
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(link)
	code := parsed.Query().Get("token")
	if len(code) < 40 {
		t.Fatal("weak action token")
	}
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := st.ConsumeAuthAction(context.Background(), hashAction(code), "verify", ""); e == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatalf("single use token consumed %d times", successes.Load())
	}
	verified, _ := st.UserByID(context.Background(), u.ID)
	if !verified.EmailVerified {
		t.Fatal("verification not persisted")
	}
	link, err = s.sendAction(context.Background(), u, "reset")
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ = url.Parse(link)
	code = parsed.Query().Get("token")
	next, _ := s.hash("long new password")
	if _, err = st.ConsumeAuthAction(context.Background(), hashAction(code), "reset", next); err != nil {
		t.Fatal(err)
	}
	if _, err = s.parse(tok); err == nil {
		t.Fatal("reset left old bearer token active")
	}
	if _, err = s.parseTicket(ticket); err == nil {
		t.Fatal("reset left old ws ticket active")
	}
	if _, err = st.ConsumeAuthAction(context.Background(), hashAction(code), "reset", next); err == nil {
		t.Fatal("reset token replay succeeded")
	}
}
func TestActionExpiryPurposeAndThrottle(t *testing.T) {
	st := memstore.New()
	u, _ := st.CreateUser(context.Background(), "person@example.com", "hash")
	if err := st.SaveAuthAction(context.Background(), u.ID, "verify", "expired", time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConsumeAuthAction(context.Background(), "expired", "verify", ""); err == nil {
		t.Fatal("expired action accepted")
	}
	if err := st.SaveAuthAction(context.Background(), u.ID, "verify", "second", time.Now().Add(time.Hour)); err == nil {
		t.Fatal("rapid resend accepted")
	}
	if err := st.SaveAuthAction(context.Background(), u.ID, "reset", "reset", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConsumeAuthAction(context.Background(), "reset", "verify", ""); err == nil {
		t.Fatal("wrong purpose accepted")
	}
}
func TestJWTRequiresExpiryAndExactAlgorithm(t *testing.T) {
	s := New(nil, "test-secret", time.Hour)
	for _, method := range []*jwt.SigningMethodHMAC{jwt.SigningMethodHS256, jwt.SigningMethodHS384} {
		token, _ := jwt.NewWithClaims(method, jwt.RegisteredClaims{Subject: "uid", Audience: jwt.ClaimStrings{"api"}}).SignedString([]byte("test-secret"))
		if _, err := s.parse(token); err == nil {
			t.Fatal("accepted absent-expiry or wrong-algorithm token")
		}
	}
}
func TestHostedRegistrationCannotGrantAdminOrBypassMail(t *testing.T) {
	st := memstore.New()
	s := New(st, "test-secret", time.Hour)
	body := `{"email":"founder@mockinterview.live","password":"long test password"}`
	s.Configure(Options{RequireVerification: true})
	w := httptest.NewRecorder()
	s.Register(w, httptest.NewRequest("POST", "/register", strings.NewReader(body)))
	if w.Code != 503 {
		t.Fatalf("unconfigured production mail status %d", w.Code)
	}
	s.Configure(Options{Development: true, PublicURL: "http://localhost:3000"})
	w = httptest.NewRecorder()
	s.Register(w, httptest.NewRequest("POST", "/register", strings.NewReader(body)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	u, _ := st.UserByEmail(context.Background(), "founder@mockinterview.live")
	if u.Role == "admin" || u.EmailVerified {
		t.Fatal("registration elevated identity")
	}
	if out["development_action_url"] == nil {
		t.Fatal("local verification link missing")
	}
}
func TestForgotPasswordDoesNotDiscloseAccount(t *testing.T) {
	st := memstore.New()
	s := New(st, "test-secret", time.Hour)
	_, _ = st.CreateUser(context.Background(), "person@example.com", "hash")
	var first []byte
	for _, email := range []string{"person@example.com", "absent@example.com"} {
		b, _ := json.Marshal(map[string]string{"email": email})
		w := httptest.NewRecorder()
		s.ForgotPassword(w, httptest.NewRequest(http.MethodPost, "/forgot", bytes.NewReader(b)))
		if first == nil {
			first = w.Body.Bytes()
		} else if !bytes.Equal(first, w.Body.Bytes()) {
			t.Fatal("forgot response discloses account existence")
		}
	}
}
