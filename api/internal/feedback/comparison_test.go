package feedback

import (
	"bytes"
	"context"
	"encoding/json"
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

func TestOptionalComparisonHTTPValidationPrivacyAndCompatibility(t *testing.T) {
	ctx := context.Background()
	repo := &roleRepo{Mem: memstore.New()}
	u, _ := repo.CreateUser(ctx, "comparison-http@example.test", "unused")
	other, _ := repo.CreateUser(ctx, "other-http@example.test", "unused")
	svc := New(repo, nil)
	router := chi.NewRouter()
	router.Use(auth.New(repo, "comparison-test-key", time.Hour).Required)
	router.Get("/sessions/{id}/feedback", svc.GetInterview)
	router.Put("/sessions/{id}/feedback", svc.PutInterview)
	router.Get("/admin/metrics", svc.InterviewMetrics)
	router.Get("/admin/comments", svc.InterviewComments)
	tokenFor := func(uid string) string {
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: uid, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte("comparison-test-key"))
		return token
	}
	token := tokenFor(u.ID)
	request := func(method, path string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, ok := body.([]byte)
		if !ok {
			raw, _ = json.Marshal(body)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s got%d want%d: %s", method, path, w.Code, want, w.Body)
		}
		return w
	}
	a, err := repo.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: u.ID, QuestionID: "comparison-synthetic", DurationMinutes: 5, Mode: "text", FeedbackVersion: store.InterviewFeedbackVersion, QuestionSnapshot: json.RawMessage(`{"domain":"coding","title":"Synthetic public title","reference_answer":"PRIVATE_REFERENCE"}`)}, Identity: u.ID, Unlimited: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.AcquireLive(ctx, a.ID, "test"); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.ActivateLive(ctx, a.ID, "test"); err != nil {
		t.Fatal(err)
	}
	_ = repo.ReleaseLive(ctx, a.ID, "test")
	_ = repo.UpdateSessionStatus(ctx, a.ID, "feedback_failed")
	path := "/sessions/" + a.ID + "/feedback"
	w := request("GET", path, nil, 200)
	var env surveyEnvelope
	if json.Unmarshal(w.Body.Bytes(), &env) != nil || env.Questionnaire.ComparisonVersion != store.ToolComparisonVersion || env.Questionnaire.Version != store.InterviewFeedbackVersion || len(env.Questionnaire.Questions) != 6 {
		t.Fatal("optional capability changed core questionnaire")
	}
	body := map[string]any{"version": store.InterviewFeedbackVersion, "answers": answersForSurvey()}
	request("PUT", path, body, 200)
	comparison := map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "tool_names": "  Synthetic tool token=private-tool-key  ", "preference": "other_tools_better", "details": "  Specific comparison api_key=private-detail-key  "}
	body["comparison"] = comparison
	w = request("PUT", path, body, 200)
	if json.Unmarshal(w.Body.Bytes(), &env) != nil || env.Response.Comparison == nil || env.Required || env.Response.Comparison.ToolNames != "Synthetic tool [redacted]" || env.Response.Comparison.Details != "Specific comparison [redacted]" || env.Response.ShareTranscript {
		t.Fatal("comparison roundtrip/redaction/consent", w.Body)
	}
	first := *env.Response
	request("PUT", path, body, 200)
	same, _ := repo.GetInterviewFeedback(ctx, u.ID, a.ID)
	if !same.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatal("retry changed timestamps")
	}
	delete(body, "comparison")
	request("PUT", path, body, 200)
	same, _ = repo.GetInterviewFeedback(ctx, u.ID, a.ID)
	if same.Comparison == nil || !same.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatal("old client omission erased comparison")
	}
	request("GET", "/admin/comments", nil, 403)
	request("GET", "/admin/metrics", nil, 403)
	repo.admin = true
	w = request("GET", "/admin/comments?limit=1", nil, 200)
	if !strings.Contains(w.Body.String(), `"comparison":{"version":"tool-comparison-v1"`) || strings.Contains(w.Body.String(), u.ID) || strings.Contains(w.Body.String(), u.Email) || strings.Contains(w.Body.String(), "PRIVATE_REFERENCE") || strings.Contains(w.Body.String(), "private-tool-key") {
		t.Fatal("comparison-only admin suggestion privacy", w.Body)
	}
	w = request("GET", "/admin/metrics", nil, 200)
	if strings.Contains(w.Body.String(), "Specific comparison") || strings.Contains(w.Body.String(), "Synthetic tool") || !strings.Contains(w.Body.String(), `"other_tools_better_rate":1`) {
		t.Fatal("metrics text leakage/counts", w.Body)
	}
	repo.admin = false
	request("GET", "/admin/comments", nil, 403)
	token = tokenFor(other.ID)
	request("GET", path, nil, 404)
	request("PUT", path, body, 404)
	token = tokenFor(u.ID)
	for _, invalid := range []any{[]any{}, "wrong", map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "details": "\x00"}, map[string]any{}, map[string]any{"version": "stale", "prior_use": "yes"}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "sometimes"}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "preference": "best"}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "unknown": true}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "no", "details": "not allowed"}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "prefer_not_to_say", "tool_names": "not allowed"}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "tool_names": strings.Repeat("語", 301)}, map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "details": strings.Repeat("語", 1001)}} {
		body["comparison"] = invalid
		w = request("PUT", path, body, 400)
		if !strings.Contains(w.Body.String(), "Optional tool comparison") {
			t.Fatal("misleading core questionnaire error", w.Body)
		}
	}
	body["comparison"] = map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "details": "invalid-utf8"}
	raw, _ := json.Marshal(body)
	raw = bytes.ReplaceAll(raw, []byte("invalid-utf8"), []byte{0xff})
	request("PUT", path, raw, 400)
	body["comparison"] = map[string]any{"version": store.ToolComparisonVersion, "prior_use": "yes", "tool_names": strings.Repeat("語", 300), "details": strings.Repeat("語", 1000)}
	request("PUT", path, body, 200)
	for _, prior := range []string{"yes", "no", "prefer_not_to_say"} {
		body["comparison"] = map[string]any{"version": store.ToolComparisonVersion, "prior_use": prior}
		request("PUT", path, body, 200)
	}
	body["comparison"] = nil
	w = request("PUT", path, body, 200)
	if json.Unmarshal(w.Body.Bytes(), &env) != nil || env.Response.Comparison != nil || !env.Response.SubmittedAt.Equal(first.SubmittedAt) {
		t.Fatal("explicit null clear/first submission", w.Body)
	}
	cleared := env.Response.UpdatedAt
	w = request("PUT", path, body, 200)
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	if !env.Response.UpdatedAt.Equal(cleared) {
		t.Fatal("null retry timestamp")
	}
}

func TestComparisonMetricsDenominatorsAndGroups(t *testing.T) {
	session := store.Session{QuestionID: "synthetic", QuestionSnapshot: json.RawMessage(`{"title":"Synthetic","domain":"coding"}`)}
	rows := []store.InterviewFeedbackRow{{Session: session}, {Session: session, Response: &store.InterviewFeedback{Answers: answersForSurvey()}}}
	for _, preference := range []string{"mockinterview_better", "about_same", "other_tools_better", "unable_to_judge", ""} {
		rows = append(rows, store.InterviewFeedbackRow{Session: session, Response: &store.InterviewFeedback{Answers: answersForSurvey(), Comparison: &store.ToolComparison{Version: store.ToolComparisonVersion, PriorUse: "yes", Preference: preference, ToolNames: "NEVER_AGGREGATE_NAMES", Details: "NEVER_AGGREGATE_DETAILS"}}})
	}
	for _, prior := range []string{"no", "prefer_not_to_say"} {
		rows = append(rows, store.InterviewFeedbackRow{Session: store.Session{QuestionSnapshot: json.RawMessage(`{"domain":"behavioral"}`)}, Response: &store.InterviewFeedback{Answers: answersForSurvey(), Comparison: &store.ToolComparison{Version: store.ToolComparisonVersion, PriorUse: prior}}})
	}
	out := aggregateMetrics(rows, 30, "subject", time.Now())
	m := out.Comparison
	if out.Totals.Eligible != 9 || out.Totals.Responded != 8 || m.InstrumentVersion != store.ToolComparisonVersion || m.Answered != 7 || m.Skipped != 1 || m.Compared != 3 || m.PriorUse["yes"] != 5 || m.PriorUse["no"] != 1 || m.PriorUse["prefer_not_to_say"] != 1 || m.Preference["unable_to_judge"] != 1 || m.OtherToolsBetterRate == nil || *m.OtherToolsBetterRate != 1.0/3 {
		t.Fatalf("comparison denominators %+v", m)
	}
	if len(out.Groups) != 2 {
		t.Fatal("groups")
	}
	for _, g := range out.Groups {
		if g.Key == "coding" && (g.Comparison.Answered != 5 || g.Comparison.Skipped != 1 || g.Comparison.Compared != 3) {
			t.Fatal("coding comparison group")
		}
		if g.Key == "behavioral" && (g.Comparison.Answered != 2 || g.Comparison.Skipped != 0 || g.Comparison.Compared != 0 || g.Comparison.OtherToolsBetterRate != nil) {
			t.Fatal("opt-out comparison group")
		}
	}
	raw, _ := json.Marshal(out)
	if bytes.Contains(raw, []byte("NEVER_AGGREGATE")) {
		t.Fatal("free text leaked")
	}
	empty := aggregateMetrics(nil, 30, "subject", time.Now())
	if empty.Comparison.Answered != 0 || empty.Comparison.Skipped != 0 || empty.Comparison.OtherToolsBetterRate != nil || len(empty.Comparison.PriorUse) != 3 || len(empty.Comparison.Preference) != 4 {
		t.Fatal("empty metric must have full zero distribution and null rate")
	}
}
