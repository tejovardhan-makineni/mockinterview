package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/feedback"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/sqlitestore"
)

type desktopFlowTransport func(*http.Request) (*http.Response, error)

func (f desktopFlowTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// The real router, SQLite repository, BYOK client, WebSocket director, scoring
// worker and restart paths run together. Only the outbound provider transport
// is synthetic. Unknown external requests fail closed; no credentials or paid
// model calls are used, and no deterministic LLM demo is installed.
func TestDesktopSQLitePersonalKeyInterviewFlow(t *testing.T) {
	const personalKey = "sk-desktop-flow-synthetic-key"
	const bridge = "desktop-flow-bridge-token-synthetic-000000000"
	const model = "synthetic-compatible-model"
	const workspace = "I would first assess preservation risks, record the condition of each item, agree handling procedures with a conservator, and prioritize fragile items for safe digitization."
	var validations, plans, turns, assessments atomic.Int32
	originalTransport := http.DefaultTransport
	http.DefaultTransport = desktopFlowTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme == "http" && r.URL.Hostname() == "127.0.0.1" {
			return originalTransport.RoundTrip(r)
		}
		if r.URL.String() != "https://api.openai.com/v1/chat/completions" {
			return nil, fmt.Errorf("unexpected external request blocked: %s", r.URL.Host)
		}
		respond := func(status int, body string) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
		}
		if r.Header.Get("Authorization") != "Bearer "+personalKey {
			return respond(401, `{"error":{"message":"Synthetic key rejected"}}`)
		}
		var input struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			return nil, err
		}
		if input.Model != model {
			return nil, fmt.Errorf("personal model changed to %q", input.Model)
		}
		system, all := "", ""
		for _, message := range input.Messages {
			all += message.Content
			if message.Role == "system" {
				system = message.Content
			}
		}
		output := ""
		switch {
		case all == "Reply with OK.":
			validations.Add(1)
			output = "OK"
		case strings.Contains(system, "Design an interview practice plan"):
			plans.Add(1)
			if !strings.Contains(all, "Research librarian") {
				return nil, errors.New("custom profession lost")
			}
			output = `{"name":"Archive leadership practice","stages":[{"id":"intro","title":"Practice goal","kind":"intro","guidance":"Confirm the archive leadership goal.","share":0.1},{"id":"practice","title":"Preservation decisions","kind":"core","guidance":"Ask one question about protecting fragile archives.","share":0.8},{"id":"wrap","title":"Reflection","kind":"wrap","guidance":"Invite final questions.","share":0.1}],"rubric":[{"key":"reasoning","label":"Reasoning","description":"Explains prioritization decisions.","weight":1},{"key":"evidence","label":"Evidence","description":"Uses concrete examples.","weight":1},{"key":"communication","label":"Communication","description":"Explains the approach clearly.","weight":1}]}`
		case strings.Contains(system, "rigorous, fair interview evaluator"):
			assessments.Add(1)
			if !strings.Contains(all, workspace) {
				return nil, errors.New("saved evidence missing from scoring")
			}
			output = `{"scores":[{"dimension":"reasoning","score":3,"assessed":true,"coverage_pct":75,"expected":"Assess risks before acting","actual":"Identified preservation risks","evidence_refs":[{"source_id":"workspace","quote":"assess preservation risks"}]},{"dimension":"evidence","score":0,"assessed":false,"coverage_pct":0},{"dimension":"communication","score":0,"assessed":false,"coverage_pct":0}],"strengths":["Clear prioritization"],"gaps":["Give a specific past example"],"coaching_md":"Practice explaining the preservation tradeoff with a concrete example."}`
		default:
			turns.Add(1)
			if !strings.Contains(system, "Research librarian") {
				return nil, errors.New("private custom snapshot missing from director")
			}
			output = "For your Research librarian practice, how would you protect fragile archives while improving access?"
		}
		body, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": output}}}})
		if err != nil {
			return nil, err
		}
		return respond(200, string(body))
	})
	defer func() { http.DefaultTransport = originalTransport }()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	catalog, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	database := filepath.Join(t.TempDir(), "interviews.sqlite")
	cfg := &config.Config{LocalDesktop: true, JWTSecret: strings.Repeat("j", 40), JWTTTL: time.Hour, SessionEncryptionKey: base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))}
	var repo *sqlitestore.Store
	var server *httptest.Server
	var stopWorker context.CancelFunc
	var token string
	stop := func() {
		if stopWorker != nil {
			stopWorker()
			stopWorker = nil
		}
		if server != nil {
			server.Close()
			server = nil
		}
		if repo != nil {
			if err := repo.Close(); err != nil {
				t.Error(err)
			}
			repo = nil
		}
	}
	defer stop()
	start := func() {
		t.Helper()
		repo, err = sqlitestore.Open(ctx, database)
		if err != nil {
			t.Fatal(err)
		}
		background, stopBackground := context.WithCancel(ctx)
		stopWorker = stopBackground
		server = httptest.NewUnstartedServer(nil)
		cfg.PublicURL = "http://" + server.Listener.Addr().String()
		cfg.CORSAllow = []string{cfg.PublicURL}
		application := &App{Background: background, Cfg: cfg, Store: repo, LLM: llm.DesktopClient{}, Corpus: catalog}
		router := chi.NewRouter()
		router.Use(desktopBridge(bridge, server.Listener.Addr().String()))
		router.Use(llm.DesktopCredentials)
		router.Route("/api/v1", application.Routes)
		server.Config.Handler = router
		server.Start()
	}
	start()
	request := func(method, path string, body any, want int) []byte {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, server.URL+path, bytes.NewReader(encoded))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Desktop-Token", bridge)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != want {
			t.Fatalf("%s %s: status %d, want %d: %s", method, path, response.StatusCode, want, data)
		}
		if bytes.Contains(data, []byte(personalKey)) {
			t.Fatal("personal key leaked into API response")
		}
		return data
	}
	bootstrap := func() string {
		t.Helper()
		var value struct {
			Token string `json:"token"`
			User  struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		if err := json.Unmarshal(request("GET", "/api/v1/desktop/bootstrap", nil, 200), &value); err != nil {
			t.Fatal(err)
		}
		if value.Token == "" || value.User.ID == "" {
			t.Fatal("empty local identity")
		}
		token = value.Token
		return value.User.ID
	}
	userID := bootstrap()
	request("POST", "/api/v1/sessions", map[string]any{"funding": "platform"}, 400)
	for _, key := range []string{"", "invalid-synthetic-key"} {
		request("POST", "/api/v1/providers/validate", map[string]string{"provider": "openai", "model": model, "mode": "text", "api_key": key}, 400)
	}
	request("POST", "/api/v1/providers/validate", map[string]string{"provider": "openai", "model": model, "mode": "text", "api_key": personalKey}, 200)
	create := map[string]any{"funding": "byok", "provider": "openai", "model": model, "mode": "text", "minutes": 15, "config": map[string]any{"voice_id": "aoede", "face_id": "alex", "personality": "neutral", "intensity": 3}, "custom": map[string]string{"profession": "Research librarian", "goal": "Lead an archive team", "level": "Senior department lead", "questions": "How do you preserve fragile archives?", "structure": "Scenario then leadership"}}
	request("POST", "/api/v1/sessions", create, 400)
	create["api_key"] = "invalid-synthetic-key"
	request("POST", "/api/v1/sessions", create, 400)
	create["api_key"] = personalKey
	var attempt store.Session
	if err := json.Unmarshal(request("POST", "/api/v1/sessions", create, 200), &attempt); err != nil {
		t.Fatal(err)
	}
	if attempt.ID == "" || attempt.Funding != "byok" || attempt.Provider != "openai" {
		t.Fatalf("incorrect personal attempt: %+v", attempt)
	}
	sealed, err := repo.SessionCredential(ctx, attempt.ID)
	if err != nil || bytes.Contains(sealed, []byte(personalKey)) {
		t.Fatal("personal credential not sealed", err)
	}
	if got, err := llm.OpenKey([]byte(strings.Repeat("k", 32)), userID, attempt.ID, sealed); err != nil || got != personalKey {
		t.Fatal("cannot recover encrypted personal credential", err)
	}
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	_ = json.Unmarshal(request("GET", "/api/v1/ws-ticket", nil, 200), &ticket)
	socket, _, err := websocket.DefaultDialer.DialContext(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/sessions/"+attempt.ID+"/live?token="+ticket.Ticket, http.Header{"X-Desktop-Token": []string{bridge}, "Origin": []string{server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	readUntil := func(kind string) map[string]any {
		t.Helper()
		_ = socket.SetReadDeadline(time.Now().Add(4 * time.Second))
		for {
			var event map[string]any
			if err := socket.ReadJSON(&event); err != nil {
				t.Fatalf("waiting for %s: %v", kind, err)
			}
			if event["type"] == "error" {
				t.Fatalf("relay error: %v", event)
			}
			if event["type"] == kind {
				return event
			}
		}
	}
	if ready := readUntil("ready"); ready["mode"] != "text" || ready["deadline_at"] == nil {
		t.Fatal("missing canonical readiness", ready)
	}
	readUntil("say")
	if err := socket.WriteJSON(map[string]string{"type": "user_text", "event_id": "desktop-answer-1", "text": workspace}); err != nil {
		t.Fatal(err)
	}
	if ack := readUntil("ack"); ack["event_id"] != "desktop-answer-1" {
		t.Fatal("wrong answer acknowledgment", ack)
	}
	readUntil("say")
	artifact := request("POST", "/api/v1/sessions/"+attempt.ID+"/workspace", map[string]any{"kind": "note", "content": workspace, "revision": 1}, 200)
	if !bytes.Contains(artifact, []byte(`"revision":1`)) {
		t.Fatal("workspace revision not committed")
	}
	if err := socket.WriteJSON(map[string]string{"type": "end"}); err != nil {
		t.Fatal(err)
	}
	readUntil("saved")
	_ = socket.Close()
	until := time.Now().Add(2 * time.Second)
	for {
		current, err := repo.GetSession(ctx, attempt.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == "interrupted" {
			break
		}
		if time.Now().After(until) {
			t.Fatal("live lease did not release")
		}
		time.Sleep(5 * time.Millisecond)
	}
	request("POST", "/api/v1/sessions/"+attempt.ID+"/finish", nil, 202)
	until = time.Now().Add(5 * time.Second)
	for {
		current, err := repo.GetSession(ctx, attempt.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == "complete" {
			break
		}
		if current.Status == "feedback_failed" || time.Now().After(until) {
			t.Fatalf("scoring did not complete: %s", current.Status)
		}
		time.Sleep(10 * time.Millisecond)
	}
	report := request("GET", "/api/v1/sessions/"+attempt.ID+"/report", nil, 200)
	if !bytes.Contains(report, []byte(`"scored":true`)) || !bytes.Contains(report, []byte("assess preservation risks")) {
		t.Fatalf("missing evidence-backed report: %s", report)
	}
	if _, err := repo.SessionCredential(ctx, attempt.ID); !errors.Is(err, store.ErrCredentialExpired) {
		t.Fatal("completed session retained provider credentials", err)
	}
	if validations.Load() < 2 || plans.Load() != 1 || turns.Load() < 2 || assessments.Load() != 1 {
		t.Fatalf("real client path not exercised: validation=%d plan=%d turns=%d scoring=%d", validations.Load(), plans.Load(), turns.Load(), assessments.Load())
	}

	stop()
	start()
	if restored := bootstrap(); restored != userID {
		t.Fatal("local profile changed after restart")
	}
	restartedReport := request("GET", "/api/v1/sessions/"+attempt.ID+"/report", nil, 200)
	if !bytes.Equal(report, restartedReport) {
		t.Fatal("report changed after database restart")
	}
	transcript := request("GET", "/api/v1/sessions/"+attempt.ID+"/transcript", nil, 200)
	if bytes.Count(transcript, []byte(workspace)) != 1 {
		t.Fatal("saved candidate answer missing or duplicated")
	}
	restoredWorkspace, err := repo.GetArtifact(ctx, attempt.ID)
	if err != nil || restoredWorkspace.Content != workspace {
		t.Fatal("workspace did not survive restart", err)
	}
	metrics, err := repo.SessionMetrics(ctx, attempt.ID)
	if err != nil || metrics.TurnCount != 3 || metrics.ErrorCount != 0 {
		t.Fatalf("incorrect durable metrics: %+v %v", metrics, err)
	}
	var survey struct {
		Questionnaire feedback.Questionnaire `json:"questionnaire"`
		Eligible      bool                   `json:"eligible"`
	}
	if err := json.Unmarshal(request("GET", "/api/v1/sessions/"+attempt.ID+"/feedback", nil, 200), &survey); err != nil {
		t.Fatal(err)
	}
	if !survey.Eligible || len(survey.Questionnaire.Questions) == 0 {
		t.Fatal("started interview lost check-in eligibility")
	}
	answers := map[string]string{}
	for _, question := range survey.Questionnaire.Questions {
		if len(question.Options) == 0 {
			t.Fatal("empty questionnaire")
		}
		answers[question.ID] = question.Options[0].Value
	}
	request("PUT", "/api/v1/sessions/"+attempt.ID+"/feedback", map[string]any{"version": survey.Questionnaire.Version, "answers": answers, "comment": "Synthetic desktop check-in", "share_transcript": false}, 200)
	request("POST", "/api/v1/feedback", map[string]any{"kind": "product", "rating": 4, "message": "Synthetic desktop feedback", "session_id": attempt.ID, "share_transcript": false}, 200)
	request("POST", "/api/v1/community/templates", map[string]string{"profession": "Research librarian", "goal": "Lead an archive team", "level": "Senior", "description": "Synthetic desktop template request for preservation leadership"}, 201)
	request("GET", "/api/v1/admin/community", nil, 403)
	exported := request("GET", "/api/v1/account/export", nil, 200)
	for _, want := range []string{workspace, "Synthetic desktop feedback", "Synthetic desktop check-in", "Synthetic desktop template request", "Practice explaining the preservation tradeoff"} {
		if !bytes.Contains(exported, []byte(want)) {
			t.Fatalf("private export omitted %q", want)
		}
	}
	for _, forbidden := range []string{personalKey, token, cfg.JWTSecret, cfg.SessionEncryptionKey, "PasswordHash", "session_credentials", "LeaseOwner"} {
		if bytes.Contains(exported, []byte(forbidden)) {
			t.Fatalf("private export included secret field %q", forbidden)
		}
	}
	if bytes.Contains(exported, []byte(`"shared_interview_results":[{`)) {
		t.Fatal("local interview was marked shared without consent")
	}
	t.Log("Desktop SQLite flow passed: BYOK validation, custom planning, acknowledged text answer, saved workspace, evidence-backed scoring, restart, private feedback, template request and secret-free export")
}
