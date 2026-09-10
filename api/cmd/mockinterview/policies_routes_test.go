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

// Route wiring test uses a synthetic export; the real PostgreSQL export is
// independently checked in TestPostgresPolicyAcknowledgmentPersistenceExportAndDeletion.
type policyRouteStore struct{ *paidRouteStore }

func (s *policyRouteStore) ExportAccount(_ context.Context, uid string) (json.RawMessage, error) {
	return json.Marshal(map[string]string{"user_id": uid})
}

func TestHostedPoliciesGateAICallsButKeepLegacyAccountControls(t *testing.T) {
	ctx := context.Background()
	repo := &policyRouteStore{&paidRouteStore{Mem: memstore.New(), verified: true}}
	u, err := repo.CreateUser(ctx, "legacy-policy-route@example.test", "unused-test-hash")
	if err != nil {
		t.Fatal(err)
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	const key = "synthetic-policy-route-signing-key"
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	model := &countedRouteModel{Client: llm.NewStub()}
	router := chi.NewRouter()
	(&App{Cfg: &config.Config{Hosted: true, JWTSecret: key, JWTTTL: time.Hour}, Store: repo, Corpus: cat, LLM: model}).Routes(router)
	request := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != want {
			t.Fatalf("%s %s status=%d want=%d body=%s", method, path, out.Code, want, out.Body)
		}
		return out
	}
	legacy, err := repo.CreateSession(ctx, u.ID, "incident-triage-checkout", "conversational", "professional", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.UpdateSessionStatus(ctx, legacy.ID, "expired"); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/resume", "/resume/review", "/resume/match", "/i18n/translate", "/providers/validate", "/sessions", "/sessions/" + legacy.ID + "/finish"} {
		out := request("POST", path, `{}`, 403)
		if !strings.Contains(out.Body.String(), `"code":"policies_required"`) {
			t.Fatalf("missing policy reason: %s", out.Body)
		}
	}
	request("PUT", "/sessions/"+legacy.ID+"/credentials", `{}`, 403)
	request("GET", "/voices/preview", "", 403)
	request("GET", "/ws-ticket", "", 403)
	request("GET", "/sessions/"+legacy.ID+"/live", "", 403)
	if model.calls.Load() != 0 {
		t.Fatal("unacknowledged paid route called provider")
	}
	if _, err = repo.LatestResume(ctx, u.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("unacknowledged resume upload saved content")
	}
	if _, err = repo.ClaimScoring(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("unacknowledged legacy finish queued feedback")
	}
	request("GET", "/auth/me", "", 200)
	request("GET", "/sessions", "", 200)
	request("GET", "/sessions/"+legacy.ID+"/transcript", "", 200)
	request("GET", "/account/export", "", 200)
	request("DELETE", "/resume", "", 204)
	request("POST", "/feedback", `{"kind":"product","message":"Synthetic private access request","include_diagnostics":false,"share_transcript":false}`, 200)
	request("DELETE", "/sessions/"+legacy.ID, "", 204)
	request("POST", "/auth/policies", `{"adult_confirmed":true,"terms_version":"old","privacy_version":"2026-09-10.1"}`, 403)
	out := request("POST", "/auth/policies", `{"adult_confirmed":true,"terms_version":"2026-09-10.1","privacy_version":"2026-09-10.1"}`, 200)
	if strings.Contains(out.Body.String(), `"policies_required":true`) {
		t.Fatal("valid acknowledgment still blocked")
	}
	request("POST", "/providers/validate", `{"provider":"gemini","model":"test","mode":"text","api_key":"synthetic-key"}`, 400)
	request("POST", "/sessions", `{"question_id":"incident-triage-checkout","mode":"voice","minutes":5}`, 400)
	request("POST", "/sessions", `{"question_id":"incident-triage-checkout","mode":"voice","minutes":5,"voice_processing_acknowledged":true,"config":{"voice_processing_acknowledged_at":"client-forged"}}`, 400)
	request("POST", "/sessions", `{"question_id":"incident-triage-checkout","mode":"text","minutes":5,"funding":"byok","provider":"gemini","model":"test","api_key":"synthetic-key"}`, 400)
	if model.calls.Load() != 0 {
		t.Fatal("missing billing or voice acknowledgment called provider")
	}
	sessions, err := repo.ListUserSessions(ctx, u.ID, 50)
	if err != nil || len(sessions) != 0 {
		t.Fatal("missing processing acknowledgments reserved an interview")
	}
	keySession, err := repo.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: u.ID, QuestionID: "incident-triage-checkout", Funding: "byok", Provider: "gemini", Model: "test", Mode: "text", DurationMinutes: 5}, Identity: "synthetic-key-reentry", Unlimited: true})
	if err != nil {
		t.Fatal(err)
	}
	out = request("PUT", "/sessions/"+keySession.ID+"/credentials", `{"api_key":"synthetic-key"}`, 400)
	if !strings.Contains(out.Body.String(), `"code":"paid_billing_required"`) {
		t.Fatal("Gemini credential re-entry bypassed billing assertion")
	}
	request("DELETE", "/sessions/"+keySession.ID, "", 204)
	var session store.Session
	out = request("POST", "/sessions", `{"question_id":"incident-triage-checkout","mode":"voice","minutes":5,"voice_processing_acknowledged":true}`, 200)
	if err = json.Unmarshal(out.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if json.Unmarshal(stored.Config, &cfg) != nil || cfg["voice_processing_acknowledged_at"] == nil || cfg["voice_processing_notice_version"] != auth.PrivacyVersion {
		t.Fatal("voice acknowledgment was not recorded by server")
	}
	if err := repo.UpdateSessionStatus(ctx, session.ID, "active"); err != nil {
		t.Fatal(err)
	}
	request("POST", "/sessions/"+session.ID+"/behavior", `{"samples":[{"ts_ms":0,"expression":{"private":"not-stored"}}]}`, 410)
	request("DELETE", "/account", "", 204)
	request("GET", "/auth/me", "", 401)
}
