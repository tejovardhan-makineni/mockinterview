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
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

func TestSessionEndpointExposesFrozenCandidateBriefWithoutPrivateAssignment(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := cat.Get("url-shortener")
	q.CandidateBrief = "Design short links for this frozen interview."
	q.Prompt = "PRIVATE full assignment: discuss regional failover later."
	q.Reference = json.RawMessage(`{"answer":"PRIVATE architecture checklist"}`)
	q.InterviewerNotes = "PRIVATE follow-up instructions"
	frozen, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	repo := memstore.New()
	u, err := repo.CreateUser(ctx, "brief@example.test", "unused-password-hash")
	if err != nil {
		t.Fatal(err)
	}
	session, err := repo.ReserveSession(ctx, store.Reservation{Unlimited: true, Session: store.Session{
		UserID: u.ID, QuestionID: q.ID, Modality: q.Modality, Track: q.Track, QuestionSnapshot: frozen,
	}})
	if err != nil {
		t.Fatal(err)
	}
	const key = "synthetic-candidate-brief-test-key"
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Use(auth.New(repo, key, time.Hour).Required)
	router.Get("/sessions/{id}", New(repo, cat, nil, nil, 0).Get)
	request := httptest.NewRequest("GET", "/sessions/"+session.ID, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "PRIVATE") {
		t.Fatalf("private frozen assignment leaked: %s", response.Body.String())
	}
	var payload struct {
		Question corpus.Summary `json:"question"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Question.Prompt != q.CandidateBrief || payload.Question.CandidateBrief != q.CandidateBrief {
		t.Fatalf("must retain the frozen public opening, got %+v", payload.Question)
	}
	stored, err := repo.GetSession(ctx, session.ID)
	if err != nil || string(stored.QuestionSnapshot) != string(frozen) {
		t.Fatal("serving a public brief must not rewrite the private frozen assignment")
	}
}
