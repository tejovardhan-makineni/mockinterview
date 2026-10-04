package interview

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/live"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type customPlanner struct {
	output string
	err    error
}

func (p customPlanner) Generate(context.Context, llm.GenerateRequest) (string, error) {
	return p.output, p.err
}
func (p customPlanner) Stubbed() bool  { return false }
func (p customPlanner) Info() llm.Info { return llm.Info{Provider: "test", Model: "test"} }

func TestCustomBriefAndPlannerValidation(t *testing.T) {
	service := &Service{}
	brief := CustomBrief{Profession: "Research librarian", Goal: "Practice leading an archive team", Level: "Senior department lead", Questions: "How do you preserve fragile archives?", Structure: "One scenario followed by a leadership discussion"}
	q, err := service.customQuestion(context.Background(), llm.NewStub(), brief, 15)
	if err != nil {
		t.Fatal(err)
	}
	if err = corpus.Validate(q); err != nil {
		t.Fatal(err)
	}
	if q.FormatDefinition == nil || len(q.Rubric) != 3 || !strings.Contains(q.Prompt, brief.Questions) {
		t.Fatalf("lost custom contract: %+v", q)
	}
	settings, _ := json.Marshal(map[string]any{"custom": brief})
	q = corpus.ApplySessionConfig(q, settings)
	if q.Settings.TargetLevel != brief.Level {
		t.Fatal("free-text seniority was replaced by a template enum")
	}
	sections := live.SectionPlan(q, false, "")
	prompt := live.SystemPrompt(q, "", 3, "intro", "", "", 15, "", "en", sections, "")
	for _, want := range []string{brief.Level, brief.Profession, brief.Questions, "untrusted", "free-text level takes precedence"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("director lost %q", want)
		}
	}
	for _, invalid := range []CustomBrief{{Goal: "goal", Level: "level"}, {Profession: "x", Goal: "g", Level: strings.Repeat("x", 121)}} {
		if invalid.validate() == nil {
			t.Fatal("invalid brief accepted")
		}
	}
	for _, planner := range []customPlanner{{err: errors.New("secret provider diagnostic")}, {output: `{}`}, {output: `{"name":"Practice","stages":[],"rubric":[]}`}} {
		if _, err = service.customQuestion(context.Background(), planner, brief, 15); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("invalid planner response or diagnostic leak: %v", err)
		}
	}
}

func TestCustomInterviewPersistsPrivatePlanAndReports(t *testing.T) {
	ctx := context.Background()
	repo := memstore.New()
	u, _ := repo.CreateUser(ctx, "custom@example.test", "hash")
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	service := New(repo, cat, scoring.New(llm.NewStub(), ""), nil, 0)
	service.SetPlanner(llm.NewStub())
	service.SetOptions(Options{PlatformProvider: "gemini", PlatformModel: "gemini-2.5-flash"})
	const secret = "custom-interview-synthetic-signing-key"
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(secret))
	router := chi.NewRouter()
	router.Use(auth.New(repo, secret, time.Hour).Required)
	router.Post("/sessions", service.Create)
	router.Get("/sessions", service.List)
	router.Get("/sessions/{id}", service.Get)
	router.Get("/sessions/{id}/report", service.Report)
	relay := live.NewRelay(repo, cat, llm.NewStub(), "", "", "", nil, func(*http.Request) (string, error) { return u.ID, nil })
	router.Get("/sessions/{id}/live", relay.Handle)
	request := func(method, path, body string, status int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	const body = `{"custom":{"profession":"Research librarian","goal":"Lead an archive team","level":"Senior department lead","questions":"How do you preserve fragile archives?","structure":"Scenario then leadership"},"minutes":15,"mode":"text"}`
	service.SetPlanner(customPlanner{err: errors.New("unavailable")})
	request("POST", "/sessions", body, 503)
	sessions, _ := repo.ListUserSessions(ctx, u.ID, 50)
	if len(sessions) != 1 || sessions[0].Status != "expired" {
		t.Fatal("failed planner did not preserve a failed, uncharged attempt")
	}
	service.SetPlanner(llm.NewStub())
	var created struct {
		store.Session
		Question corpus.Summary `json:"question"`
	}
	if err := json.Unmarshal(request("POST", "/sessions", body, 200), &created); err != nil {
		t.Fatal(err)
	}
	if created.Question.Title != "Research librarian · custom practice" || created.Question.Modality != "conversational" {
		t.Fatalf("missing safe custom summary: %+v", created.Question)
	}
	if _, exists := cat.Get(created.QuestionID); exists {
		t.Fatal("private question leaked into public catalog")
	}
	frozen, _ := repo.GetSession(ctx, created.ID)
	if !strings.Contains(string(frozen.QuestionSnapshot), "How do you preserve fragile archives?") {
		t.Fatal("original brief was not snapshotted")
	}
	for _, path := range []string{"/sessions", "/sessions/" + created.ID} {
		if !strings.Contains(string(request("GET", path, "", 200)), "Research librarian") {
			t.Fatal("history or reconnect lost title")
		}
	}
	server := httptest.NewServer(router)
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/sessions/"+created.ID+"/live", http.Header{"Authorization": []string{"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	readUntil := func(kind string) map[string]any {
		t.Helper()
		for {
			var message map[string]any
			if err := client.ReadJSON(&message); err != nil {
				t.Fatal(err)
			}
			if message["type"] == "error" {
				t.Fatal(message)
			}
			if message["type"] == kind {
				return message
			}
		}
	}
	readUntil("ready")
	opening := readUntil("say")
	if !strings.Contains(opening["text"].(string), "Research librarian") {
		t.Fatal("socket did not load custom snapshot", opening)
	}
	if err := client.WriteJSON(map[string]string{"type": "user_text", "event_id": "custom-answer", "text": "I would first assess preservation risks, record the condition of each item, agree handling procedures with a conservator, and prioritize fragile items for safe digitization."}); err != nil {
		t.Fatal(err)
	}
	readUntil("ack")
	readUntil("say")
	if err := client.WriteJSON(map[string]string{"type": "end"}); err != nil {
		t.Fatal(err)
	}
	readUntil("saved")
	_ = client.Close()
	until := time.Now().Add(time.Second)
	for {
		current, _ := repo.GetSession(ctx, created.ID)
		if current.Status == "interrupted" {
			break
		}
		if time.Now().After(until) {
			t.Fatal("live lease did not release")
		}
		time.Sleep(time.Millisecond)
	}
	metrics, err := repo.SessionMetrics(ctx, created.ID)
	if err != nil || metrics.TurnCount != 3 || metrics.ErrorCount != 0 {
		t.Fatalf("incorrect saved runtime counts: %+v %v", metrics, err)
	}
	if err := repo.BeginFinish(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	service.ProcessPending(ctx)
	report := string(request("GET", "/sessions/"+created.ID+"/report", "", 200))
	if !strings.Contains(report, "Research librarian") || !strings.Contains(report, `"dimension":"reasoning"`) {
		t.Fatal("custom report lost its title or rubric:", report)
	}
}
