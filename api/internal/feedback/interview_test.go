package feedback

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func answersForSurvey() map[string]string {
	out := map[string]string{}
	for _, id := range store.InterviewFeedbackQuestionIDs {
		out[id] = "4"
	}
	out["report_actionability"] = "report_unavailable"
	return out
}
func TestStructuredSurveyOwnershipValidationIdempotenceAndAccess(t *testing.T) {
	ctx := context.Background()
	repo := &roleRepo{Mem: memstore.New()}
	u, _ := repo.CreateUser(ctx, "survey@example.test", "PRIVATE_PASSWORD_HASH")
	other, _ := repo.CreateUser(ctx, "other@example.test", "unused")
	svc := New(repo, nil)
	router := chi.NewRouter()
	router.Use(auth.New(repo, "survey-test-key", time.Hour).Required)
	router.Get("/sessions/{id}/feedback", svc.GetInterview)
	router.Put("/sessions/{id}/feedback", svc.PutInterview)
	router.Get("/feedback/required", svc.RequiredInterviews)
	router.Get("/admin/interview-feedback/metrics", svc.InterviewMetrics)
	router.Get("/admin/interview-feedback/comments", svc.InterviewComments)
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: u.ID, Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte("survey-test-key"))
	request := func(method, path string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s got%d want%d: %s", method, path, w.Code, want, w.Body)
		}
		return w
	}
	makeSession := func(uid, version string) store.Session {
		t.Helper()
		a, e := repo.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: uid, QuestionID: "frozen-question", DurationMinutes: 5, Mode: "text", Funding: "byok", FeedbackVersion: version, QuestionSnapshot: json.RawMessage(`{"title":"Frozen public title","domain":"coding","reference_answer":"PRIVATE_REFERENCE","interviewer_instructions":"PRIVATE_INSTRUCTIONS"}`)}, Identity: uid, Unlimited: true})
		if e != nil {
			t.Fatal(e)
		}
		return a
	}
	foreign := makeSession(other.ID, store.InterviewFeedbackVersion)
	request("GET", "/sessions/"+foreign.ID+"/feedback", nil, 404)
	request("PUT", "/sessions/"+foreign.ID+"/feedback", map[string]any{}, 404)
	a := makeSession(u.ID, store.InterviewFeedbackVersion)
	path := "/sessions/" + a.ID + "/feedback"
	w := request("GET", path, nil, 200)
	if strings.Contains(w.Body.String(), `"eligible":true`) {
		t.Fatal("unused attempt eligible")
	}
	request("PUT", path, map[string]any{}, 409)
	if _, e := repo.AcquireLive(ctx, a.ID, "test"); e != nil {
		t.Fatal(e)
	}
	if _, e := repo.ActivateLive(ctx, a.ID, "test"); e != nil {
		t.Fatal(e)
	}
	_ = repo.ReleaseLive(ctx, a.ID, "test")
	_ = repo.UpdateSessionStatus(ctx, a.ID, "feedback_failed")
	w = request("GET", path, nil, 200)
	var envelope surveyEnvelope
	if json.Unmarshal(w.Body.Bytes(), &envelope) != nil || !envelope.Required || !envelope.Eligible || envelope.ReportAvailable || envelope.Questionnaire.SubjectKey != "coding" {
		t.Fatal("failed report envelope", w.Body)
	}
	if strings.Contains(w.Body.String(), "PRIVATE_") {
		t.Fatal("frozen private answer leaked")
	}
	request("GET", "/feedback/required", nil, 200)
	body := map[string]any{"version": store.InterviewFeedbackVersion, "answers": answersForSurvey(), "comment": "token=synthetic-private"}
	body["unknown"] = true
	request("PUT", path, body, 400)
	delete(body, "unknown")
	body["version"] = "old"
	request("PUT", path, body, 409)
	body["version"] = store.InterviewFeedbackVersion
	a2 := answersForSurvey()
	a2["unknown"] = "4"
	body["answers"] = a2
	request("PUT", path, body, 400)
	body["answers"] = answersForSurvey()
	body["comment"] = strings.Repeat("語", 2001)
	request("PUT", path, body, 400)
	body["comment"] = strings.Repeat("語", 2000)
	request("PUT", path, body, 200)
	body["comment"] = "token=synthetic-private"
	w = request("PUT", path, body, 200)
	first, _ := repo.GetInterviewFeedback(ctx, u.ID, a.ID)
	request("PUT", path, body, 200)
	second, _ := repo.GetInterviewFeedback(ctx, u.ID, a.ID)
	if !first.SubmittedAt.Equal(second.SubmittedAt) || !first.UpdatedAt.Equal(second.UpdatedAt) || first.ShareTranscript || strings.Contains(first.Comment, "synthetic-private") {
		t.Fatal("timestamps/redaction/default consent", first)
	}
	if strings.Contains(w.Body.String(), `"required":true`) {
		t.Fatal("response remained required")
	}
	w = request("GET", "/feedback/required", nil, 200)
	if !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("empty pending list must be array")
	}
	request("GET", "/admin/interview-feedback/metrics", nil, 403)
	request("GET", "/admin/interview-feedback/comments", nil, 403)
	repo.admin = true
	request("GET", "/admin/interview-feedback/metrics?days=0", nil, 400)
	request("GET", "/admin/interview-feedback/metrics?group_by=email", nil, 400)
	w = request("GET", "/admin/interview-feedback/metrics?group_by=subject", nil, 200)
	if strings.Contains(w.Body.String(), "PRIVATE_") || strings.Contains(w.Body.String(), u.ID) || strings.Contains(w.Body.String(), "survey@example") {
		t.Fatal("admin metrics leaked private fields")
	}
	request("GET", "/admin/interview-feedback/comments?limit=101", nil, 400)
	request("GET", "/admin/interview-feedback/comments?before=invalid", nil, 400)
	w = request("GET", "/admin/interview-feedback/comments?limit=1", nil, 200)
	if strings.Contains(w.Body.String(), "PRIVATE_") || strings.Contains(w.Body.String(), u.ID) || strings.Contains(w.Body.String(), "survey@example") || !strings.Contains(w.Body.String(), "[redacted]") || !strings.Contains(w.Body.String(), `"next_cursor":null`) {
		t.Fatal("unsafe/missing qualitative feedback", w.Body)
	}
	repo.admin = false
	request("GET", "/admin/interview-feedback/comments", nil, 403)
	repo.admin = true
	raw, e := repo.ExportAccount(ctx, u.ID)
	if e != nil || strings.Contains(string(raw), "PRIVATE_PASSWORD_HASH") || strings.Contains(string(raw), "PRIVATE_REFERENCE") || !strings.Contains(string(raw), "interview_feedback") {
		t.Fatal("export privacy boundary", e)
	}
	if e = repo.DeleteSession(ctx, a.ID); e != nil {
		t.Fatal(e)
	}
	request("GET", path, nil, 404)
	rows, _ := repo.InterviewFeedbackWindow(ctx, time.Now().Add(-time.Hour), time.Now())
	if len(rows) != 0 {
		t.Fatal("deleted response denominator retained")
	}
	legacy, _ := repo.CreateSession(ctx, u.ID, "legacy", "conversational", "engineering", "", "", nil)
	_ = repo.UpdateSessionStatus(ctx, legacy.ID, "complete")
	w = request("GET", "/sessions/"+legacy.ID+"/feedback", nil, 200)
	if strings.Contains(w.Body.String(), `"required":true`) {
		t.Fatal("legacy backlog gated")
	}
}
func TestSurveyMetricsDirectionMissingResponsesAndNoComposite(t *testing.T) {
	now := time.Now()
	rows := []store.InterviewFeedbackRow{}
	for i := 0; i < 300; i++ {
		a := store.Session{QuestionID: "frozen", QuestionSnapshot: json.RawMessage(`{"title":"Frozen","domain":"coding","reference_answer":"PRIVATE"}`), Config: json.RawMessage(`{"target_level":"senior"}`)}
		row := store.InterviewFeedbackRow{Session: a}
		if i < 200 {
			answers := answersForSurvey()
			answers["challenge_fit"] = "3"
			answers["disruption_severity"] = "2"
			if i < 100 {
				answers["report_actionability"] = "5"
			} else if i < 150 {
				answers["report_actionability"] = "report_not_read"
			}
			row.Response = &store.InterviewFeedback{Version: store.InterviewFeedbackVersion, Answers: answers}
		}
		rows = append(rows, row)
	}
	out := aggregateMetrics(rows, 30, "subject", now)
	if out.Totals.Eligible != 300 || out.Totals.Responded != 200 || out.Totals.Pending != 100 || out.Totals.ResponseRate == nil || *out.Totals.ResponseRate != float64(2)/3 {
		t.Fatal("biased denominator", out.Totals)
	}
	g := out.Groups[0]
	for _, q := range g.Questions {
		switch q.ID {
		case "report_actionability":
			if q.Answered != 100 || q.Unrated != 100 || q.Distribution["report_not_read"] != 50 || q.Distribution["report_unavailable"] != 50 || q.Mean == nil || *q.Mean != 5 || q.FavorableRate == nil || *q.FavorableRate != 1 {
				t.Fatal("unrated report distorted numeric summary", q)
			}
		case "challenge_fit":
			if q.Mean != nil || q.Favorable != 200 {
				t.Fatal("challenge direction", q)
			}
		case "disruption_severity":
			if q.Mean != nil || q.Favorable != 0 {
				t.Fatal("disruption direction", q)
			}
		}
	}
	if key, _ := grouping(rows[0].Session, "level"); key != "senior" {
		t.Fatal("wrong frozen level", key)
	}
	empty := aggregateMetrics(nil, 30, "subject", now)
	raw, _ := json.Marshal(empty)
	if empty.Totals.ResponseRate != nil || !strings.Contains(string(raw), `"groups":[]`) || strings.Contains(string(raw), "overall") {
		t.Fatal("empty/composite semantics", string(raw))
	}
}
