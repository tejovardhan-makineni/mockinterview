package feedback

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type roleRepo struct {
	*memstore.Mem
	admin bool
}

func (r *roleRepo) UserByID(ctx context.Context, id string) (store.User, error) {
	u, e := r.Mem.UserByID(ctx, id)
	if r.admin {
		u.Role = "admin"
	}
	return u, e
}
func TestConsentRatingOwnershipAndTriage(t *testing.T) {
	mem := memstore.New()
	repo := &roleRepo{Mem: mem}
	identity := auth.New(mem, "feedback-test-key", time.Hour)
	identity.Configure(auth.Options{Development: true})
	reg := httptest.NewRecorder()
	identity.Register(reg, httptest.NewRequest("POST", "/register", strings.NewReader(`{"email":"admin@example.com","password":"password12345"}`)))
	if reg.Code != 200 {
		t.Fatal(reg.Body.String())
	}
	var account struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if e := json.Unmarshal(reg.Body.Bytes(), &account); e != nil {
		t.Fatal(e)
	}
	session, e := mem.CreateSession(context.Background(), account.User.ID, "q", "conversational", "test", "", "", json.RawMessage(`{}`))
	if e != nil {
		t.Fatal(e)
	}
	service := New(repo, []string{"admin@example.com"})
	routes := chi.NewRouter()
	routes.Use(identity.Required)
	routes.Post("/feedback", service.Submit)
	routes.Patch("/feedback/{id}", service.Triage)
	routes.Get("/feedback", service.List)
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		r.Header.Set("Authorization", "Bearer "+account.Token)
		w := httptest.NewRecorder()
		routes.ServeHTTP(w, r)
		return w
	}
	body := map[string]any{"kind": "product", "rating": 4, "context": map[string]any{"target": "product_experience", "session_id": session.ID, "api_key": "sk-sensitive-value-secret", "connection": "private diagnostic", "transcript_tail": []map[string]string{{"role": "candidate", "text": "private transcript"}}}}
	if w := request("POST", "/feedback", body); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	items, _ := mem.ListFeedback(context.Background(), 20)
	if len(items) != 1 || items[0].Rating != 4 || items[0].Message != "" {
		t.Fatalf("rating only not saved: %+v", items)
	}
	stored := string(items[0].Context)
	if !strings.Contains(stored, "product_experience") {
		t.Fatal("lost safe target")
	}
	for _, v := range []string{"private diagnostic", "private transcript", "sk-sensitive"} {
		if strings.Contains(stored, v) {
			t.Fatalf("unconsented or secret data persisted: %s", stored)
		}
	}
	body["include_diagnostics"] = true
	body["share_transcript"] = true
	body["message"] = "Please inspect token=topsecret and api_key=keysecret"
	if w := request("POST", "/feedback", body); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	items, _ = mem.ListFeedback(context.Background(), 20)
	stored = string(items[0].Context)
	if !strings.Contains(stored, "private transcript") || !strings.Contains(stored, "private diagnostic") {
		t.Fatal("explicitly shared evidence omitted")
	}
	if strings.Contains(items[0].Message, "topsecret") || strings.Contains(items[0].Message, "keysecret") || strings.Contains(stored, "sk-sensitive") {
		t.Fatalf("secret redaction failed: %+v", items[0])
	}
	other, e := mem.CreateUser(context.Background(), "other@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	foreign, e := mem.CreateSession(context.Background(), other.ID, "q", "conversational", "test", "", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	body["session_id"] = foreign.ID
	if w := request("POST", "/feedback", body); w.Code != 403 {
		t.Fatalf("foreign context=%d", w.Code)
	}
	if w := request("GET", "/feedback", nil); w.Code != 403 {
		t.Fatalf("email string grants admin=%d", w.Code)
	}
	if w := request("PATCH", "/feedback/"+items[0].ID, map[string]string{"status": "reviewed"}); w.Code != 403 {
		t.Fatalf("user triage=%d", w.Code)
	}
	repo.admin = true
	if w := request("PATCH", "/feedback/"+items[0].ID, map[string]string{"status": "reviewed"}); w.Code != http.StatusOK {
		t.Fatalf("admin triage=%d %s", w.Code, w.Body.String())
	}
	if w := request("PATCH", "/feedback/"+items[0].ID, map[string]string{"status": "arbitrary"}); w.Code != 400 {
		t.Fatalf("invalid triage=%d", w.Code)
	}
	if e = mem.DeleteUser(context.Background(), account.User.ID); e != nil {
		t.Fatal(e)
	}
	items, _ = mem.ListFeedback(context.Background(), 20)
	if len(items) != 0 {
		t.Fatal("account deletion retained feedback")
	}
}
