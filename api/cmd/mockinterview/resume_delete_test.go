package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

func TestResumeDeletionIsOwnerOnlyAndDoesNotRequirePaidFeatureEligibility(t *testing.T) {
	ctx := context.Background()
	repo := memstore.New()
	owner, err := repo.CreateUser(ctx, "resume-owner@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.CreateUser(ctx, "other-owner@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	if owner.EmailVerified || owner.PoliciesAcceptedAt != nil {
		t.Fatal("test owner must be unverified with no policy acknowledgment")
	}
	for _, uid := range []string{owner.ID, other.ID} {
		if _, err := repo.SaveResume(ctx, uid, "private.txt", "Synthetic private resume", nil); err != nil {
			t.Fatal(err)
		}
	}
	session, err := repo.CreateSession(ctx, owner.ID, "test-question", "conversational", "professional", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	const key = "synthetic-resume-deletion-signing-key"
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject: owner.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	model := &countedRouteModel{Client: llm.NewStub()}
	app := &App{Cfg: &config.Config{Hosted: true, JWTSecret: key, JWTTTL: time.Hour}, Store: repo, Corpus: cat, LLM: model}
	router := chi.NewRouter()
	app.Routes(router)
	request := func(auth string, want int) {
		t.Helper()
		// The caller cannot select another owner through a request parameter.
		req := httptest.NewRequest(http.MethodDelete, "/resume?user_id="+other.ID, nil)
		if auth != "" {
			req.Header.Set("Authorization", "Bearer "+auth)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("DELETE /resume status=%d want=%d body=%s", res.Code, want, res.Body)
		}
		if want == http.StatusNoContent && res.Body.Len() != 0 {
			t.Fatal("resume deletion should return an empty response")
		}
	}
	request("", http.StatusUnauthorized)
	if _, err := repo.LatestResume(ctx, owner.ID); err != nil {
		t.Fatal("unauthenticated request deleted a resume")
	}
	request(token, http.StatusNoContent)
	request(token, http.StatusNoContent) // Empty accounts remain an idempotent success.
	if _, err := repo.LatestResume(ctx, owner.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted owner resume still available: %v", err)
	}
	if _, err := repo.LatestResume(ctx, other.ID); err != nil {
		t.Fatalf("another owner's resume was affected: %v", err)
	}
	if _, err := repo.GetSession(ctx, session.ID); err != nil {
		t.Fatalf("resume deletion removed interview history: %v", err)
	}
	if model.calls.Load() != 0 {
		t.Fatal("data deletion must not call a model")
	}
}
