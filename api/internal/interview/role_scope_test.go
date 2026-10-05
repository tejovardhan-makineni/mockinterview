package interview

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/pack"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

func TestValidateRoleAndSeniorityConfig(t *testing.T) {
	for _, raw := range []string{
		`{}`, `{"role_track":"individual_contributor","target_level":"principal"}`,
		`{"role_track":"management","target_level":"senior_manager"}`, `{"role_track":"management","target_level":"director"}`,
		`{"role_track":"executive","target_level":"vp"}`, `{"role_track":"executive","target_level":"executive"}`,
	} {
		if _, err := validateConfig(json.RawMessage(raw)); err != nil {
			t.Errorf("valid config %s: %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"role_track":"leadership"}`, `{"role_track":null}`, `{"role_track":[]}`, `{"role_track":""}`,
		`{"target_level":"ceo"}`, `{"target_level":null}`, `{"role_track":"management","hidden_reference":"secret"}`,
	} {
		if _, err := validateConfig(json.RawMessage(raw)); err == nil {
			t.Errorf("invalid config accepted: %s", raw)
		}
	}
}

func TestPackRoleScopePersistsDefaultsAndCandidateOverrides(t *testing.T) {
	original, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := original.Get("url-shortener")
	// A synthetic legacy-format fixture isolates metadata from evolving content.
	q.ID, q.SchemaVersion, q.RoleTrack, q.Difficulty = "synthetic-manager", 0, "management", "manager"
	q.FormatDefinition, q.InterviewerDefinition = nil, nil
	dir := t.TempDir()
	encoded, _ := json.Marshal(q)
	if err := os.WriteFile(filepath.Join(dir, q.ID+".json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	cat, err := corpus.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	packDir := t.TempDir()
	p := pack.Pack{ID: "synthetic-path", Name: "Manager path", Areas: q.Areas, Rounds: []pack.Round{{ID: "decision", Title: "Management decision", Domain: q.Domain, Modality: q.Modality, Difficulty: "director", Minutes: 20, QuestionID: q.ID}}}
	encoded, _ = json.Marshal(p)
	if err := os.WriteFile(filepath.Join(packDir, p.ID+".json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	packs, err := pack.Load(packDir, cat)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, config, level, track string }{
		{"authored defaults", `{}`, "director", "management"},
		{"candidate override", `{"target_level":"vp","role_track":"executive"}`, "vp", "executive"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := memstore.New()
			u, _ := repo.CreateUser(context.Background(), "scope@example.test", "hash")
			service := New(repo, cat, scoring.New(llm.NewStub(), ""), nil, 0)
			service.SetOptions(Options{PlatformProvider: "gemini", PlatformModel: "test"})
			service.SetPacks(pack.NewService(cat, packs, repo))
			const secret = "synthetic-role-scope-signing-key"
			token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(secret))
			router := chi.NewRouter()
			router.Use(auth.New(repo, secret, time.Hour).Required)
			router.Post("/sessions", service.Create)
			router.Get("/sessions/{id}", service.Get)
			call := func(method, path, body string) []byte {
				t.Helper()
				r := httptest.NewRequest(method, path, strings.NewReader(body))
				r.Header.Set("Authorization", "Bearer "+token)
				w := httptest.NewRecorder()
				router.ServeHTTP(w, r)
				if w.Code != 200 {
					t.Fatalf("%s: %d %s", path, w.Code, w.Body)
				}
				return w.Body.Bytes()
			}
			var created store.Session
			body := `{"pack_id":"synthetic-path","round_id":"decision","mode":"text","config":` + tc.config + `}`
			if err := json.Unmarshal(call("POST", "/sessions", body), &created); err != nil {
				t.Fatal(err)
			}
			frozen, err := repo.GetSession(context.Background(), created.ID)
			if err != nil {
				t.Fatal(err)
			}
			var snapshot corpus.Question
			if err := json.Unmarshal(frozen.QuestionSnapshot, &snapshot); err != nil {
				t.Fatal(err)
			}
			if snapshot.RoleTrack != "management" || snapshot.Difficulty != "manager" {
				t.Fatal("authored snapshot was rewritten")
			}
			if frozen.DurationMinutes != 20 {
				t.Fatal("pack duration default lost")
			}
			configured := corpus.ApplySessionConfig(snapshot, frozen.Config)
			if configured.Settings.TargetLevel != tc.level || configured.Settings.RoleTrack != tc.track {
				t.Fatalf("saved scope: %+v", configured.Settings)
			}
			var recovered struct {
				Config   corpus.SessionSettings `json:"config"`
				Question corpus.Summary         `json:"question"`
			}
			recovery := call("GET", "/sessions/"+created.ID, "")
			if err := json.Unmarshal(recovery, &recovered); err != nil {
				t.Fatal(err)
			}
			if recovered.Config.TargetLevel != tc.level || recovered.Config.RoleTrack != tc.track || recovered.Question.RoleTrack != "management" {
				t.Fatalf("reconnect lost scope: %s", recovery)
			}
			if strings.Contains(string(recovery), "interviewer_notes") || strings.Contains(string(recovery), "\"reference\"") {
				t.Fatal("recovery leaked private content")
			}
		})
	}
}

func TestLegacySessionResponseKeepsUnspecifiedRoleAndSavedTitle(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	legacy, _ := cat.Get("url-shortener")
	legacy.RoleTrack, legacy.Title = "", "Saved legacy scenario title"
	snapshot, _ := json.Marshal(legacy)
	repo := memstore.New()
	user, _ := repo.CreateUser(context.Background(), "legacy-scope@example.test", "hash")
	sess, err := repo.ReserveSession(context.Background(), store.Reservation{Session: store.Session{UserID: user.ID, QuestionID: legacy.ID, QuestionSnapshot: snapshot, Config: json.RawMessage(`{"target_level":"senior"}`)}, Identity: "legacy-scope", Unlimited: true})
	if err != nil {
		t.Fatal(err)
	}
	service := New(repo, cat, scoring.New(llm.NewStub(), ""), nil, 0)
	w := httptest.NewRecorder()
	service.writeSession(w, httptest.NewRequest("GET", "/sessions/"+sess.ID, nil), sess)
	if w.Code != 200 {
		t.Fatalf("read failed: %d %s", w.Code, w.Body)
	}
	var response struct {
		Question corpus.Summary `json:"question"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Question.RoleTrack != "" || response.Question.Title != legacy.Title {
		t.Fatalf("legacy response inherited current metadata: %+v", response.Question)
	}
	if err := repo.SaveReport(context.Background(), sess.ID, 0, json.RawMessage(`{}`), json.RawMessage(`[]`), json.RawMessage(`{}`), "", false, "Saved report"); err != nil {
		t.Fatal(err)
	}
	const secret = "synthetic-legacy-report-secret"
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: user.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(secret))
	router := chi.NewRouter()
	router.Use(auth.New(repo, secret, time.Hour).Required)
	router.Get("/sessions/{id}/report", service.Report)
	req := httptest.NewRequest("GET", "/sessions/"+sess.ID+"/report", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var report struct {
		Title string `json:"question_title"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &report) != nil || report.Title != legacy.Title {
		t.Fatalf("report rewrote saved title: %d %s", w.Code, w.Body)
	}
}
