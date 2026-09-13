package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type testerRouteStore struct {
	*memstore.Mem
	roles     map[string]string
	lookupErr error
}

func (s *testerRouteStore) UserByID(ctx context.Context, id string) (store.User, error) {
	u, err := s.Mem.UserByID(ctx, id)
	u.Role = s.roles[id]
	return u, err
}
func (s *testerRouteStore) IsTester(ctx context.Context, id string) (bool, error) {
	if s.lookupErr != nil {
		return false, s.lookupErr
	}
	return s.Mem.IsTester(ctx, id)
}

func TestTesterAdminAPIAndHostedAccess(t *testing.T) {
	ctx := context.Background()
	repo := &testerRouteStore{Mem: memstore.New(), roles: map[string]string{}}
	const key = "synthetic-tester-route-key"
	newUser := func(email, role string, verified bool) (store.User, string) {
		t.Helper()
		u, err := repo.CreateUser(ctx, email, "unused")
		if err != nil {
			t.Fatal(err)
		}
		repo.roles[u.ID] = role
		if verified {
			if err := repo.SaveAuthAction(ctx, u.ID, "verify", u.ID, time.Now().Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.ConsumeAuthAction(ctx, u.ID, "verify", ""); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := repo.AcceptPolicies(ctx, u.ID, auth.TermsVersion, auth.PrivacyVersion); err != nil {
			t.Fatal(err)
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(key))
		if err != nil {
			t.Fatal(err)
		}
		return u, token
	}
	admin, adminToken := newUser("admin@example.test", "admin", true)
	_, ordinaryToken := newUser("regular@example.test", "user", true)
	_, unverifiedAdminToken := newUser("unverified-admin@example.test", "admin", false)
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	app := &App{Cfg: &config.Config{Hosted: true, JWTSecret: key, JWTTTL: time.Hour, LLMProvider: "gemini", LLMModel: "test", HostedDailyStartLimit: 1}, Store: repo, Corpus: cat, LLM: llm.NewStub()}
	router := chi.NewRouter()
	app.Routes(router)
	request := func(token, method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s got %d want %d: %s", method, path, w.Code, want, w.Body)
		}
		return w
	}
	for _, method := range []string{"GET", "POST", "DELETE"} {
		request("", method, "/admin/testers", `{"email":"tester@example.test"}`, 401)
		request(ordinaryToken, method, "/admin/testers", `{"email":"tester@example.test"}`, 403)
		request(unverifiedAdminToken, method, "/admin/testers", `{"email":"tester@example.test"}`, 403)
	}
	for _, email := range []string{"", "not-an-email", "Name <test@example.test>", "a@example.test,b@example.test"} {
		body, _ := json.Marshal(map[string]string{"email": email})
		request(adminToken, "POST", "/admin/testers", string(body), 400)
	}
	added := request(adminToken, "POST", "/admin/testers", `{"email":" TESTER@Example.TEST "}`, 200)
	if !strings.Contains(added.Body.String(), `"email":"tester@example.test"`) {
		t.Fatal("email was not normalized")
	}
	duplicate := request(adminToken, "POST", "/admin/testers", `{"email":"tester@example.test"}`, 200)
	if duplicate.Body.String() != added.Body.String() {
		t.Fatal("duplicate changed tester record")
	}
	tester, testerToken := newUser("tester@example.test", "user", false)
	request(testerToken, "POST", "/providers/validate", `{}`, 403)
	request(testerToken, "POST", "/sessions", `{"question_id":"incident-triage-checkout","minutes":5,"mode":"text","funding":"platform"}`, 403)
	request(testerToken, "GET", "/admin/testers", "", 403)
	if err := repo.SaveAuthAction(ctx, tester.ID, "verify", tester.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ConsumeAuthAction(ctx, tester.ID, "verify", ""); err != nil {
		t.Fatal(err)
	}
	request(testerToken, "GET", "/admin/testers", "", 403)
	usage := request(testerToken, "GET", "/usage", "", 200)
	if !strings.Contains(usage.Body.String(), `"tester_unlimited":true`) || !strings.Contains(usage.Body.String(), `"local_unlimited":false`) {
		t.Fatal("usage conflated local and tester", usage.Body)
	}
	for range 35 {
		request(testerToken, "POST", "/providers/validate", `{}`, 400)
	}
	// The handler executes for unlimited testers; failures checking eligibility
	// must fail closed before invoking a paid handler.
	repo.lookupErr = errors.New("synthetic lookup failure")
	request(testerToken, "POST", "/providers/validate", `{}`, 503)
	repo.lookupErr = nil
	const body = `{"question_id":"incident-triage-checkout","minutes":5,"mode":"text","funding":"platform"}`
	var session store.Session
	if err := json.Unmarshal(request(testerToken, "POST", "/sessions", body, 200).Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AcquireLive(ctx, session.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ActivateLive(ctx, session.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateSessionStatus(ctx, session.ID, "complete"); err != nil {
		t.Fatal(err)
	}
	if err := repo.ReleaseLive(ctx, session.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	required := request(testerToken, "GET", "/feedback/required", "", 200)
	if !strings.Contains(required.Body.String(), `"total":0`) {
		t.Fatal("tester received required feedback")
	}
	survey := request(testerToken, "GET", "/sessions/"+session.ID+"/feedback", "", 200)
	if !strings.Contains(survey.Body.String(), `"required":false`) || !strings.Contains(survey.Body.String(), `"eligible":true`) {
		t.Fatal("tester survey should be optional", survey.Body)
	}
	request(testerToken, "POST", "/sessions", body, 200)
	request(adminToken, "DELETE", "/admin/testers", `{"email":"tester@example.test"}`, 204)
	request(adminToken, "DELETE", "/admin/testers", `{"email":"tester@example.test"}`, 204)
	for range 30 {
		request(testerToken, "POST", "/providers/validate", `{}`, 400)
	}
	request(testerToken, "POST", "/providers/validate", `{}`, 429)
	usage = request(testerToken, "GET", "/usage", "", 200)
	if !strings.Contains(usage.Body.String(), `"tester_unlimited":false`) || !strings.Contains(usage.Body.String(), `"funded_available":false`) {
		t.Fatal("removal failed to restore quota", usage.Body)
	}
	required = request(testerToken, "GET", "/feedback/required", "", 200)
	if !strings.Contains(required.Body.String(), `"total":1`) {
		t.Fatal("removal failed to restore feedback gate")
	}
	// Revoking the persisted role immediately removes administration even though
	// the caller still has the original, otherwise-valid JWT.
	repo.roles[admin.ID] = "user"
	request(adminToken, "POST", "/admin/testers", `{"email":"new@example.test"}`, 403)
}
