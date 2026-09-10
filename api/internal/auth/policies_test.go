package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

func TestRegistrationRequiresCurrentAdultAssertionBeforeCreatingUser(t *testing.T) {
	for _, fields := range []string{
		``,
		`,"adult_confirmed":false,"terms_version":"2026-09-10","privacy_version":"2026-09-10"`,
		`,"adult_confirmed":true,"terms_version":"older","privacy_version":"2026-09-10"`,
		`,"adult_confirmed":true,"terms_version":"2026-09-10","privacy_version":"older"`,
	} {
		st := memstore.New()
		s := New(st, "synthetic-policy-test", time.Hour)
		s.Configure(Options{RequirePolicies: true})
		response := httptest.NewRecorder()
		s.Register(response, httptest.NewRequest("POST", "/register", strings.NewReader(`{"email":"policy@example.test","password":"long test password"`+fields+`}`)))
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"policies_required"`) {
			t.Fatalf("invalid assertion status=%d body=%s", response.Code, response.Body)
		}
		if _, err := st.UserByEmail(context.Background(), "policy@example.test"); !errors.Is(err, store.ErrNotFound) {
			t.Fatal("rejected assertion created an account")
		}
	}
	st := memstore.New()
	s := New(st, "synthetic-policy-test", time.Hour)
	s.Configure(Options{RequirePolicies: true})
	start := time.Now().Add(-time.Second)
	response := httptest.NewRecorder()
	s.Register(response, httptest.NewRequest("POST", "/register", strings.NewReader(`{"email":"policy@example.test","password":"long test password","adult_confirmed":true,"terms_version":"2026-09-10","privacy_version":"2026-09-10"}`)))
	var auth authResponse
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &auth) != nil || auth.User.PoliciesRequired || !auth.User.AdultConfirmed {
		t.Fatalf("valid assertion registration failed: %d %s", response.Code, response.Body)
	}
	u, err := st.UserByID(context.Background(), auth.User.ID)
	if err != nil || !PoliciesAccepted(u) || u.PoliciesAcceptedAt.Before(start) || u.PoliciesAcceptedAt.After(time.Now()) {
		t.Fatal("current policy versions and server timestamp not persisted")
	}
	if u.EmailVerified || u.Role == "admin" {
		t.Fatal("policy acknowledgment elevated identity")
	}
}

func TestLegacyPolicyAcknowledgmentPreservesLoginAndRejectsStaleInput(t *testing.T) {
	ctx := context.Background()
	st := memstore.New()
	s := New(st, "synthetic-policy-test", time.Hour)
	s.Configure(Options{RequirePolicies: true})
	hash, err := s.hash("long test password")
	if err != nil {
		t.Fatal(err)
	}
	u, err := st.CreateUser(ctx, "legacy@example.test", hash)
	if err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRecorder()
	s.Login(login, httptest.NewRequest("POST", "/login", strings.NewReader(`{"email":"legacy@example.test","password":"long test password"}`)))
	var response authResponse
	if login.Code != 200 || json.Unmarshal(login.Body.Bytes(), &response) != nil || !response.User.PoliciesRequired {
		t.Fatal("legacy user cannot log in and see acknowledgment requirement")
	}
	call := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest("POST", "/policies", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+response.Token)
		out := httptest.NewRecorder()
		s.Required(http.HandlerFunc(s.AcceptPolicies)).ServeHTTP(out, request)
		return out
	}
	for _, body := range []string{`{}`, `{"adult_confirmed":false,"terms_version":"2026-09-10","privacy_version":"2026-09-10"}`, `{"adult_confirmed":true,"terms_version":"old","privacy_version":"2026-09-10"}`} {
		if out := call(body); out.Code != 403 {
			t.Fatalf("invalid acknowledgment: %d %s", out.Code, out.Body)
		}
		stored, _ := st.UserByID(ctx, u.ID)
		if stored.PoliciesAcceptedAt != nil {
			t.Fatal("invalid acknowledgment mutated user")
		}
	}
	const valid = `{"adult_confirmed":true,"terms_version":"2026-09-10","privacy_version":"2026-09-10"}`
	if out := call(valid); out.Code != 200 || strings.Contains(out.Body.String(), `"policies_required":true`) {
		t.Fatalf("accept: %d %s", out.Code, out.Body)
	}
	accepted, _ := st.UserByID(ctx, u.ID)
	if out := call(valid); out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	repeated, _ := st.UserByID(ctx, u.ID)
	if !accepted.PoliciesAcceptedAt.Equal(*repeated.PoliciesAcceptedAt) || repeated.EmailVerified || repeated.TokenVersion != u.TokenVersion {
		t.Fatal("idempotent acknowledgment changed timestamp, verification or token version")
	}
	if _, err := s.parse(response.Token); err != nil {
		t.Fatal("acknowledgment revoked existing login")
	}
}

func TestLocalRegistrationPreservesNoPolicySetup(t *testing.T) {
	s := New(memstore.New(), "synthetic-local", time.Hour)
	out := httptest.NewRecorder()
	s.Register(out, httptest.NewRequest("POST", "/register", strings.NewReader(`{"email":"local@example.test","password":"long test password"}`)))
	if out.Code != 200 || strings.Contains(out.Body.String(), `"policies_required":true`) {
		t.Fatalf("local registration broke: %d %s", out.Code, out.Body)
	}
}
