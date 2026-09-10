package main

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

type paidRouteStore struct {
	*memstore.Mem
	verified bool
}

func (s *paidRouteStore) UserByID(ctx context.Context, id string) (store.User, error) {
	u, err := s.Mem.UserByID(ctx, id)
	u.EmailVerified = s.verified
	return u, err
}

type countedRouteModel struct {
	llm.Client
	calls atomic.Int32
}

func (m *countedRouteModel) Generate(ctx context.Context, req llm.GenerateRequest) (string, error) {
	m.calls.Add(1)
	return m.Client.Generate(ctx, req)
}

func TestHostedPaidRoutesRequireVerificationAndResumeUploadIsLimited(t *testing.T) {
	ctx := context.Background()
	repo := &paidRouteStore{Mem: memstore.New()}
	u, err := repo.CreateUser(ctx, "unverified@example.test", "unused-test-password-hash")
	if err != nil {
		t.Fatal(err)
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	const key = "synthetic-paid-route-test-signing-key"
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	model := &countedRouteModel{Client: llm.NewStub()}
	app := &App{Cfg: &config.Config{Hosted: true, JWTSecret: key, JWTTTL: time.Hour}, Store: repo, Corpus: cat, LLM: model}
	router := chi.NewRouter()
	app.Routes(router)
	request := func(method, path, contentType string, body []byte, want int) {
		t.Helper()
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, response.Code, want, response.Body)
		}
	}
	var upload bytes.Buffer
	form := multipart.NewWriter(&upload)
	file, err := form.CreateFormFile("file", "synthetic-resume.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("Synthetic candidate. Built a checkout service and documented incident recovery.")); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request("POST", "/resume", form.FormDataContentType(), upload.Bytes(), 403)
	for _, path := range []string{"/resume/review", "/resume/match", "/i18n/translate", "/providers/validate"} {
		request("POST", path, "application/json", []byte(`{}`), 403)
	}
	request("GET", "/voices/preview", "", nil, 403)
	if model.calls.Load() != 0 {
		t.Fatal("unverified paid feature called the model")
	}
	if _, err := repo.LatestResume(ctx, u.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("unverified upload was persisted")
	}
	// A pre-verification legacy attempt remains readable but cannot queue a
	// paid assessment until its owner has proved email ownership.
	legacy, err := repo.CreateSession(ctx, u.ID, "incident-triage-checkout", "conversational", "professional", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateSessionStatus(ctx, legacy.ID, "expired"); err != nil {
		t.Fatal(err)
	}
	request("POST", "/sessions/"+legacy.ID+"/finish", "", nil, 403)
	request("GET", "/sessions", "", nil, 200)
	if _, err := repo.ClaimScoring(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("unverified legacy finish queued scoring")
	}
	repo.verified = true
	if _, err := repo.AcceptPolicies(ctx, u.ID, auth.TermsVersion, auth.PrivacyVersion); err != nil {
		t.Fatal(err)
	}
	request("POST", "/sessions/"+legacy.ID+"/finish", "", nil, 202)
	job, err := repo.ClaimScoring(ctx)
	if err != nil || job.SessionID != legacy.ID || model.calls.Load() != 0 {
		t.Fatal("verified legacy owner could not queue feedback without prematurely calling the model")
	}
	for i := 0; i < 30; i++ {
		request("POST", "/resume", form.FormDataContentType(), upload.Bytes(), 200)
	}
	request("POST", "/resume", form.FormDataContentType(), upload.Bytes(), 429)
	if model.calls.Load() != 30 {
		t.Fatalf("rate-limited upload made unexpected model calls: %d", model.calls.Load())
	}
	if res, err := repo.LatestResume(ctx, u.ID); err != nil || !strings.Contains(res.ParsedText, "Synthetic candidate") {
		t.Fatal("verified upload did not save the expected resume")
	}
}
