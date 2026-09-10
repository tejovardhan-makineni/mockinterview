package interview

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type quotaRepo struct {
	*memstore.Mem
	role string
}

func (r *quotaRepo) UserByID(ctx context.Context, id string) (store.User, error) {
	u, err := r.Mem.UserByID(ctx, id)
	u.Role, u.EmailVerified = r.role, true
	return u, err
}

func TestHostedAllowanceAppliesToAdminsAndLocalRemainsUnlimited(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"admin", "user"} {
		for _, hosted := range []bool{true, false} {
			name := "local/" + role
			if hosted {
				name = "hosted/" + role
			}
			t.Run(name, func(t *testing.T) {
				ctx := context.Background()
				repo := &quotaRepo{Mem: memstore.New(), role: role}
				u, err := repo.CreateUser(ctx, "quota@example.test", "unused-password-hash")
				if err != nil {
					t.Fatal(err)
				}
				const signingKey = "synthetic-quota-test-signing-secret"
				token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(signingKey))
				if err != nil {
					t.Fatal(err)
				}
				service := New(repo, cat, scoring.New(llm.NewStub(), ""), nil, 0)
				service.SetOptions(Options{Hosted: hosted, EncryptionKey: []byte(strings.Repeat("q", 32)), PlatformProvider: "gemini", PlatformModel: "test"})
				router := chi.NewRouter()
				router.Use(auth.New(repo, signingKey, time.Hour).Required)
				router.Post("/sessions", service.Create)
				router.Post("/sessions/{id}/finish", service.Finish)
				router.Get("/usage", service.Usage)
				request := func(method, path, body string, want int) *httptest.ResponseRecorder {
					t.Helper()
					req := httptest.NewRequest(method, path, strings.NewReader(body))
					req.Header.Set("Authorization", "Bearer "+token)
					req.Header.Set("Content-Type", "application/json")
					response := httptest.NewRecorder()
					router.ServeHTTP(response, req)
					if response.Code != want {
						t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, response.Code, want, response.Body)
					}
					return response
				}
				const body = `{"question_id":"incident-triage-checkout","minutes":5,"mode":"text","funding":"platform"}`
				var first store.Session
				if err := json.Unmarshal(request("POST", "/sessions", body, 200).Body.Bytes(), &first); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.AcquireLive(ctx, first.ID, "test-connection"); err != nil {
					t.Fatal(err)
				}
				active, err := repo.ActivateLive(ctx, first.ID, "test-connection")
				if err != nil {
					t.Fatal(err)
				}
				if err := repo.ReleaseLive(ctx, first.ID, "test-connection"); err != nil {
					t.Fatal(err)
				}
				request("POST", "/sessions/"+first.ID+"/finish", "", 202)
				service.ProcessPending(ctx)
				request("POST", "/sessions/"+first.ID+"/finish", "", 200)
				var usage store.Usage
				if err := json.Unmarshal(request("GET", "/usage", "", 200).Body.Bytes(), &usage); err != nil {
					t.Fatal(err)
				}
				if usage.LocalUnlimited != !hosted || usage.FundedAvailable != !hosted || usage.ActiveSessionID != "" {
					t.Fatalf("unexpected allowance: %+v", usage)
				}
				if hosted {
					if usage.NextStartAt == nil || usage.NextFundedAt == nil || usage.NextStartAt.Sub(*active.StartedAt) != 24*time.Hour || usage.NextFundedAt.Sub(*active.StartedAt) != 7*24*time.Hour {
						t.Fatalf("hosted quota windows were not enforced: %+v", usage)
					}
					request("POST", "/sessions", body, 429)
				} else {
					if usage.NextStartAt != nil || usage.NextFundedAt != nil {
						t.Fatalf("local quota windows should be absent: %+v", usage)
					}
					request("POST", "/sessions", body, 200)
				}
			})
		}
	}
}
