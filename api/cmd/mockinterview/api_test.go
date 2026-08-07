package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

// testServer wires the real router against the in-memory store and the LLM
// stub, so these tests exercise routing + middleware + handlers with no
// Postgres and no Gemini key.
func testServer(t *testing.T, adminEmails []string, dailyLimit int) *httptest.Server {
	t.Helper()
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatalf("load corpus: %v", err)
	}
	cfg := &config.Config{
		JWTSecret:      "test-secret",
		JWTTTL:         time.Hour,
		AdminEmails:    adminEmails,
		FreeDailyLimit: dailyLimit,
		ModelLive:      "stub",
		ModelTTS:       "stub",
	}
	app := &App{Cfg: cfg, Store: memstore.New(), LLM: llm.NewStub(), Corpus: cat}
	r := chi.NewRouter()
	r.Route("/api/v1", app.Routes)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

type client struct {
	t     *testing.T
	base  string
	token string
}

func (c *client) do(method, path string, body any) (*http.Response, []byte) {
	c.t.Helper()
	var buf *bytes.Buffer
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewBuffer(b)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req, _ := http.NewRequest(method, c.base+path, buf)
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	var out bytes.Buffer
	_, _ = out.ReadFrom(res.Body)
	return res, out.Bytes()
}

func (c *client) register(email, pw string) {
	c.t.Helper()
	res, body := c.do("POST", "/api/v1/auth/register", map[string]string{"email": email, "password": pw})
	if res.StatusCode != http.StatusOK {
		c.t.Fatalf("register %s: status %d body %s", email, res.StatusCode, body)
	}
	var ar struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(body, &ar)
	if ar.Token == "" {
		c.t.Fatal("register returned no token")
	}
	c.token = ar.Token
}

func firstQuestionID(t *testing.T) string {
	t.Helper()
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	list := cat.List("", "", "")
	if len(list) == 0 {
		t.Fatal("empty corpus")
	}
	return list[0].ID
}

// End-to-end happy path: register → me → save config → create session → list →
// finish (stub scoring) → report.
func TestInterviewHappyPath(t *testing.T) {
	srv := testServer(t, nil, 100)
	c := &client{t: t, base: srv.URL}
	c.register("alice@test.com", "password123")

	if res, _ := c.do("GET", "/api/v1/auth/me", nil); res.StatusCode != 200 {
		t.Fatalf("me: %d", res.StatusCode)
	}

	// Invalid config is rejected.
	bad := map[string]any{"voice_id": "nope", "face_id": "ava", "personality": "neutral", "intensity": 3}
	if res, _ := c.do("PUT", "/api/v1/config", bad); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid config should be 400, got %d", res.StatusCode)
	}
	good := map[string]any{"voice_id": "aoede", "face_id": "sophia", "personality": "neutral", "intensity": 3}
	if res, _ := c.do("PUT", "/api/v1/config", good); res.StatusCode != 200 {
		t.Fatalf("valid config should be 200, got %d", res.StatusCode)
	}

	// Create a session.
	res, body := c.do("POST", "/api/v1/sessions", map[string]any{"question_id": firstQuestionID(t), "config": good})
	if res.StatusCode != 200 {
		t.Fatalf("create session: %d %s", res.StatusCode, body)
	}
	var sess struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(body, &sess)
	if sess.ID == "" {
		t.Fatal("no session id")
	}

	// Add a substantive candidate turn so scoring has something to assess.
	longAnswer := "I would start by clarifying functional and non-functional requirements, then estimate traffic and storage, sketch a high level design with a load balancer, stateless app tier, a sharded key value store, and a cache, and finally discuss replication, failover, and observability in depth."
	c.do("POST", "/api/v1/sessions/"+sess.ID+"/turns", map[string]any{"role": "candidate", "text": longAnswer, "ts_ms": 1000})

	// It shows up in history.
	if res, body := c.do("GET", "/api/v1/sessions", nil); res.StatusCode != 200 {
		t.Fatalf("list: %d %s", res.StatusCode, body)
	}

	// Finish → scoring runs via the stub.
	res, body = c.do("POST", "/api/v1/sessions/"+sess.ID+"/finish", nil)
	if res.StatusCode != 200 {
		t.Fatalf("finish: %d %s", res.StatusCode, body)
	}

	// Report is available and carries scores.
	res, body = c.do("GET", "/api/v1/sessions/"+sess.ID+"/report", nil)
	if res.StatusCode != 200 {
		t.Fatalf("report: %d %s", res.StatusCode, body)
	}
	var rep struct {
		Scores []map[string]any `json:"scores"`
	}
	_ = json.Unmarshal(body, &rep)
	if len(rep.Scores) == 0 {
		t.Errorf("report should include scored dimensions: %s", body)
	}
}

// Resume flow: upload text → review (scored critique) → match against a JD.
// Uploads use multipart; the stub returns deterministic structured data.
func TestResumeReviewAndMatch(t *testing.T) {
	srv := testServer(t, nil, 100)
	c := &client{t: t, base: srv.URL}
	c.register("resume@test.com", "password123")

	// Match before uploading a resume must 400.
	if res, _ := c.do("POST", "/api/v1/resume/match", map[string]string{"job_description": "Senior Go engineer, Kafka, AWS."}); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("match without resume should be 400, got %d", res.StatusCode)
	}

	// Upload a plain-text resume (multipart/form-data, field "file").
	var mb bytes.Buffer
	mw := multipart.NewWriter(&mb)
	fw, _ := mw.CreateFormFile("file", "alex.txt")
	_, _ = fw.Write([]byte("Alex Candidate\nSenior Software Engineer\n\nEXPERIENCE\nAcme — Worked on the payments ledger service.\n\nSKILLS\nGo, Postgres, Kafka"))
	_ = mw.Close()
	upReq, _ := http.NewRequest("POST", srv.URL+"/api/v1/resume", &mb)
	upReq.Header.Set("Content-Type", mw.FormDataContentType())
	upReq.Header.Set("Authorization", "Bearer "+c.token)
	upRes, err := http.DefaultClient.Do(upReq)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if upRes.StatusCode != http.StatusOK {
		t.Fatalf("upload should be 200, got %d", upRes.StatusCode)
	}
	_ = upRes.Body.Close()

	// Review → scored critique with the enriched fields.
	res, body := c.do("POST", "/api/v1/resume/review", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("review: %d %s", res.StatusCode, body)
	}
	var rev struct {
		OverallScore  float64          `json:"overall_score"`
		LineEdits     []map[string]any `json:"line_edits"`
		CriticalFixes []map[string]any `json:"critical_fixes"`
	}
	_ = json.Unmarshal(body, &rev)
	if rev.OverallScore <= 0 || rev.OverallScore > 5 {
		t.Errorf("overall_score out of range: %v", rev.OverallScore)
	}
	if len(rev.LineEdits) == 0 {
		t.Errorf("review should include line_edits: %s", body)
	}

	// Empty JD is rejected.
	if res, _ := c.do("POST", "/api/v1/resume/match", map[string]string{"job_description": "  "}); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty JD should be 400, got %d", res.StatusCode)
	}

	// Match with a real JD → score in [0,100] plus keyword arrays.
	res, body = c.do("POST", "/api/v1/resume/match", map[string]string{"job_description": "Senior Go engineer. Must have Kafka, Postgres, AWS, Terraform."})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("match: %d %s", res.StatusCode, body)
	}
	var m struct {
		MatchScore      float64  `json:"match_score"`
		MatchedKeywords []string `json:"matched_keywords"`
		MissingKeywords []string `json:"missing_keywords"`
	}
	_ = json.Unmarshal(body, &m)
	if m.MatchScore < 0 || m.MatchScore > 100 {
		t.Errorf("match_score out of range: %v", m.MatchScore)
	}
	if len(m.MatchedKeywords) == 0 || len(m.MissingKeywords) == 0 {
		t.Errorf("match should include matched + missing keywords: %s", body)
	}
}

// A signed-out request to a protected route is rejected.
func TestAuthRequired(t *testing.T) {
	srv := testServer(t, nil, 100)
	c := &client{t: t, base: srv.URL}
	if res, _ := c.do("GET", "/api/v1/sessions", nil); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list should be 401, got %d", res.StatusCode)
	}
}

// Free users are capped at the daily limit; admins bypass it.
func TestDailyLimitAndAdminBypass(t *testing.T) {
	srv := testServer(t, []string{"admin@test.com"}, 1)
	qid := firstQuestionID(t)

	// Free user: first session ok, second is 429.
	free := &client{t: t, base: srv.URL}
	free.register("free@test.com", "password123")
	if res, _ := free.do("POST", "/api/v1/sessions", map[string]any{"question_id": qid}); res.StatusCode != 200 {
		t.Fatalf("first session should be 200, got %d", res.StatusCode)
	}
	if res, _ := free.do("POST", "/api/v1/sessions", map[string]any{"question_id": qid}); res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second session should be 429, got %d", res.StatusCode)
	}

	// Admin: no cap.
	admin := &client{t: t, base: srv.URL}
	admin.register("admin@test.com", "password123")
	for i := 0; i < 3; i++ {
		if res, _ := admin.do("POST", "/api/v1/sessions", map[string]any{"question_id": qid}); res.StatusCode != 200 {
			t.Fatalf("admin session %d should be 200, got %d", i, res.StatusCode)
		}
	}
}
