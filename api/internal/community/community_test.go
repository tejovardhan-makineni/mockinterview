package community

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type roleStore struct {
	*memstore.Mem
	roles map[string]string
}

func (s *roleStore) UserByID(ctx context.Context, id string) (store.User, error) {
	u, e := s.Mem.UserByID(ctx, id)
	u.Role = s.roles[id]
	return u, e
}
func TestPrivateCommunityConsentAndBetaLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := &roleStore{Mem: memstore.New(), roles: map[string]string{}}
	const secret = "community-test-secret"
	makeUser := func(email, role string, verified bool) (string, string) {
		t.Helper()
		u, e := repo.CreateUser(ctx, email, "unused")
		if e != nil {
			t.Fatal(e)
		}
		repo.roles[u.ID] = role
		if verified {
			if e = repo.SaveAuthAction(ctx, u.ID, "verify", u.ID, time.Now().Add(time.Hour)); e != nil {
				t.Fatal(e)
			}
			if _, e = repo.ConsumeAuthAction(ctx, u.ID, "verify", ""); e != nil {
				t.Fatal(e)
			}
		}
		token, e := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(secret))
		if e != nil {
			t.Fatal(e)
		}
		return u.ID, token
	}
	owner, ownerToken := makeUser(store.OwnerEmail, "user", true)
	uid, userToken := makeUser("member@example.com", "user", true)
	_, otherToken := makeUser("other@example.com", "admin", true)
	_, unverifiedToken := makeUser("unverified@example.com", "user", false)
	service := New(repo)
	router := chi.NewRouter()
	router.Use(auth.New(repo, secret, time.Hour).Required)
	router.Get("/admin", service.AdminOverview)
	router.Post("/beta", service.ApplyBeta)
	router.Patch("/beta/{id}", service.ReviewBeta)
	router.Post("/templates", service.RequestTemplate)
	router.Patch("/templates/{id}", service.ReviewTemplate)
	router.Post("/analytics", service.ShareAnalytics)
	router.Delete("/analytics", service.DeleteAnalytics)
	request := func(token, method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s got %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	request("", "GET", "/admin", "", 401)
	request(userToken, "GET", "/admin", "", 403)
	request(ownerToken, "GET", "/admin", "", 403)
	request(otherToken, "GET", "/admin", "", 403)
	repo.roles[owner] = "admin"
	request(ownerToken, "GET", "/admin", "", 200)
	request(unverifiedToken, "POST", "/beta", `{"motivation":"Test all available professions","feedback_commitment":true}`, 403)
	request(userToken, "POST", "/beta", `{"motivation":"Test all available professions","feedback_commitment":false}`, 400)
	result := request(userToken, "POST", "/beta", `{"motivation":"Test all available professions","feedback_commitment":true}`, 200)
	var application store.BetaApplication
	if e := json.Unmarshal(result.Body.Bytes(), &application); e != nil {
		t.Fatal(e)
	}
	if eligible, _ := repo.IsTester(ctx, uid); eligible {
		t.Fatal("application self-granted access")
	}
	request(userToken, "PATCH", "/beta/"+application.ID, `{"status":"approved"}`, 403)
	request(ownerToken, "PATCH", "/beta/"+application.ID, `{"status":"approved"}`, 204)
	if eligible, _ := repo.IsTester(ctx, uid); !eligible {
		t.Fatal("approved verified tester not entitled")
	}
	request(ownerToken, "PATCH", "/beta/"+application.ID, `{"status":"rejected"}`, 204)
	if eligible, _ := repo.IsTester(ctx, uid); eligible {
		t.Fatal("rejected tester retains access")
	}
	request(userToken, "POST", "/templates", `{"profession":"Nurse","goal":"Emergency department","level":"Senior","description":"Please add a clinical handover scenario"}`, 201)
	analytics := `{"consent":true,"consent_version":"2026-10-04","client_session_id":"local-one","source":"local","status":"failed","provider":"openai","model":"example","duration_seconds":40,"turn_count":3,"error_count":1,"feedback":"Please inspect api_key=private-secret","report":{"overall":4,"scored":true,"coaching_md":"More examples"}}`
	request(userToken, "POST", "/analytics", strings.Replace(analytics, `"consent":true`, `"consent":false`, 1), 400)
	request(userToken, "POST", "/analytics", strings.Replace(analytics, `"consent":true`, `"consent":true,"api_key":"secret"`, 1), 400)
	request(userToken, "POST", "/analytics", strings.Replace(analytics, `"duration_seconds":40`, `"duration_seconds":-1`, 1), 400)
	request(userToken, "POST", "/analytics", strings.Replace(analytics, `"2026-10-04"`, `"old"`, 1), 400)
	request(userToken, "POST", "/analytics", strings.Replace(analytics, `"coaching_md":"More examples"`, `"coaching_md":"`+strings.Repeat("語", 30000)+`"`, 1), 413)
	request(userToken, "POST", "/analytics", strings.Replace(analytics, `"scored":true`, `"scored":true,"transcript":"private"`, 1), 400)
	request(userToken, "POST", "/analytics", analytics, 200)
	request(userToken, "POST", "/analytics", analytics, 200)
	shared, e := repo.ListSharedInterviewResults(ctx)
	if e != nil || len(shared) != 1 {
		t.Fatalf("uploads not idempotent: %v %v", shared, e)
	}
	if strings.Contains(string(shared[0].Payload), "private-secret") {
		t.Fatal("credential leaked")
	}
	request(otherToken, "DELETE", "/analytics", "", 204)
	shared, _ = repo.ListSharedInterviewResults(ctx)
	if len(shared) != 1 {
		t.Fatal("foreign analytics deleted")
	}
	raw, e := repo.ExportAccount(ctx, uid)
	if e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"beta_applications", "template_requests", "shared_interview_results"} {
		if !strings.Contains(string(raw), key) {
			t.Fatal("missing export key", key)
		}
	}
	request(userToken, "DELETE", "/analytics", "", 204)
	shared, _ = repo.ListSharedInterviewResults(ctx)
	if len(shared) != 0 {
		t.Fatal("consent withdrawal retained results")
	}
	request(userToken, "POST", "/analytics", analytics, 200)
	if e = repo.DeleteUser(ctx, uid); e != nil {
		t.Fatal(e)
	}
	a, _ := repo.ListBetaApplications(ctx)
	tr, _ := repo.ListTemplateRequests(ctx)
	shared, _ = repo.ListSharedInterviewResults(ctx)
	if len(a)+len(tr)+len(shared) != 0 {
		t.Fatal("account deletion retained private community data")
	}
	repo.roles[owner] = "user"
	request(ownerToken, "GET", "/admin", "", 403)
}
