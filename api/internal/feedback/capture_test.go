package feedback

import (
	"bytes"
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
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type captureRepo struct {
	*roleRepo
	saveErr error
}

func (r *captureRepo) SaveFeedback(ctx context.Context, uid, kind, message string, rating int, raw json.RawMessage) (string, error) {
	if r.saveErr != nil {
		return "", r.saveErr
	}
	return r.Mem.SaveFeedback(ctx, uid, kind, message, rating, raw)
}

func captureHarness(t *testing.T) (*captureRepo, store.User, func(string, any, int) *httptest.ResponseRecorder) {
	t.Helper()
	repo := &captureRepo{roleRepo: &roleRepo{Mem: memstore.New()}}
	u, err := repo.CreateUser(context.Background(), "capture@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	svc := New(repo, nil)
	router := chi.NewRouter()
	router.Use(auth.New(repo, "capture-test-key", time.Hour).Required)
	router.Post("/feedback", svc.Submit)
	router.Get("/feedback", svc.List)
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte("capture-test-key"))
	if err != nil {
		t.Fatal(err)
	}
	request := func(method string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, "/feedback", bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s /feedback got %d, want %d: %s", method, w.Code, want, w.Body)
		}
		return w
	}
	return repo, u, request
}

func TestCapturePreservesConsentedDetailsForAdminReview(t *testing.T) {
	repo, user, request := captureHarness(t)
	session, err := repo.CreateSession(context.Background(), user.ID, "question-for-capture", "conversational", "test", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	diagnostics := map[string]any{
		"page": "/interview", "connection": "connected", "mode": "voice", "ai_state": "listening",
		"status": "active", "release": "test-release", "format_version": "v1", "prompt_version": "v2",
		"section": "Follow-up", "browser": "Synthetic browser", "viewport": "1280x800",
		"language": "en-US", "timezone": "America/Los_Angeles", "online": "online",
		"target": "interviewer_realism", "unknown_private_field": "PRIVATE_UNKNOWN",
		"transcript_tail": []map[string]string{{"role": "candidate", "text": "Shared answer token=private-token"}},
	}
	body := map[string]any{
		"kind": "interviewer", "message": "The follow-up was cut off", "rating": 2,
		"session_id": session.ID, "tags": []string{"source:interview-room"}, "context": diagnostics,
	}
	for _, consent := range []struct {
		diagnostics bool
		transcript  bool
	}{{false, false}, {true, false}, {false, true}, {true, true}} {
		body["include_diagnostics"] = consent.diagnostics
		body["share_transcript"] = consent.transcript
		saved := request("POST", body, 200)
		var receipt struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(saved.Body.Bytes(), &receipt) != nil || receipt.ID == "" {
			t.Fatal("missing saved feedback reference", saved.Body)
		}
		repo.admin = false
		request("GET", nil, 403)
		repo.admin = true
		readback := request("GET", nil, 200)
		var items []store.Feedback
		if err := json.Unmarshal(readback.Body.Bytes(), &items); err != nil || len(items) == 0 {
			t.Fatal("cannot review saved feedback", err, readback.Body)
		}
		item := items[0]
		if item.ID != receipt.ID || item.UserID != user.ID || item.Email != user.Email || item.Kind != "interviewer" || item.Rating != 2 || item.Message != body["message"] || item.Status != "new" || item.CreatedAt == "" {
			t.Fatalf("incomplete feedback record: %+v", item)
		}
		var captured map[string]any
		if err := json.Unmarshal(item.Context, &captured); err != nil {
			t.Fatal(err)
		}
		if captured["session_id"] != session.ID || captured["question_id"] != session.QuestionID || captured["target"] != "interviewer_realism" || captured["include_diagnostics"] != consent.diagnostics || captured["share_transcript"] != consent.transcript {
			t.Fatalf("missing reference or consent: %s", item.Context)
		}
		tags, ok := captured["tags"].([]any)
		if !ok || len(tags) != 1 || tags[0] != "source:interview-room" {
			t.Fatalf("missing feedback source: %s", item.Context)
		}
		for key, want := range diagnostics {
			if key == "target" || key == "transcript_tail" || key == "unknown_private_field" {
				continue
			}
			if got, exists := captured[key]; exists != consent.diagnostics || exists && got != want {
				t.Fatalf("diagnostic %s: got %v, want %v with consent=%v", key, got, want, consent.diagnostics)
			}
		}
		_, shared := captured["transcript_tail"]
		if shared != consent.transcript {
			t.Fatalf("transcript consent is not independent: %s", item.Context)
		}
		if strings.Contains(string(item.Context), "PRIVATE_UNKNOWN") || strings.Contains(string(item.Context), "private-token") {
			t.Fatalf("unapproved or unredacted details persisted: %s", item.Context)
		}
	}
}

func TestCaptureRejectsLongCommentsWithoutSilentlyTruncating(t *testing.T) {
	for _, character := range []string{"a", "語", "😀"} {
		t.Run(character, func(t *testing.T) {
			repo, _, request := captureHarness(t)
			message := strings.Repeat(character, maxMessage)
			request("POST", map[string]any{"message": message}, 200)
			items, err := repo.ListFeedback(context.Background(), 20)
			if err != nil || len(items) != 1 || items[0].Message != message {
				t.Fatal("accepted feedback was truncated", err)
			}
			request("POST", map[string]any{"message": message + character}, 400)
			items, err = repo.ListFeedback(context.Background(), 20)
			if err != nil || len(items) != 1 {
				t.Fatal("oversized feedback should not be saved", err)
			}
		})
	}
}

func TestCaptureSaveFailureDoesNotReturnSuccessAndCanRetry(t *testing.T) {
	repo, _, request := captureHarness(t)
	repo.saveErr = errors.New("private database details")
	body := map[string]any{"kind": "product", "message": "Do not lose this feedback", "tags": []string{"source:header"}}
	w := request("POST", body, 500)
	if strings.Contains(w.Body.String(), "private database") || strings.Contains(w.Body.String(), `"id"`) {
		t.Fatal("save failure leaked internals or returned a saved reference", w.Body)
	}
	items, err := repo.ListFeedback(context.Background(), 20)
	if err != nil || len(items) != 0 {
		t.Fatal("failed feedback save unexpectedly persisted", err)
	}
	repo.saveErr = nil
	w = request("POST", body, 200)
	var receipt struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &receipt); err != nil || receipt.ID == "" {
		t.Fatal("retry did not receive a saved reference", err, w.Body)
	}
	items, err = repo.ListFeedback(context.Background(), 20)
	if err != nil || len(items) != 1 || items[0].ID != receipt.ID || items[0].Message != body["message"] {
		t.Fatal("retry feedback was not captured", err)
	}
}
