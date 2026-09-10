package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func testToolComparison() *ToolComparison {
	return &ToolComparison{Version: ToolComparisonVersion, PriorUse: "yes", ToolNames: "Synthetic other tool", Preference: "other_tools_better", Details: "Synthetic qualitative evidence"}
}
func comparisonSession(t *testing.T, s *Store, uid string) string {
	t.Helper()
	id := NewID()
	_, err := s.Pool.Exec(context.Background(), `INSERT INTO sessions(id,user_id,question_id,status,started_at,feedback_version,question_snapshot) VALUES($1,$2,'synthetic','feedback_failed',now()-interval '1 minute',$3,'{"title":"Public title","domain":"coding","reference_answer":"PRIVATE_REFERENCE"}')`, id, uid, InterviewFeedbackVersion)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func TestPostgresToolComparisonPresenceConcurrencyExportAndCascade(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, "comparison@example.test", "unused")
	other, _ := s.CreateUser(ctx, "other@example.test", "unused")
	id := comparisonSession(t, s, u.ID)
	f := InterviewFeedback{SessionID: id, UserID: u.ID, Version: InterviewFeedbackVersion, Answers: surveyAnswers(), ComparisonSet: true, Comparison: testToolComparison()}
	first, err := s.PutInterviewFeedback(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Comparison, f.Comparison) || first.ComparisonSet {
		t.Fatal("comparison roundtrip/internal flag")
	}
	foreign := f
	foreign.UserID = other.ID
	if _, err = s.PutInterviewFeedback(ctx, foreign); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign write", err)
	}
	if _, err = s.GetInterviewFeedback(ctx, other.ID, id); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign read", err)
	}
	omitted := f
	omitted.Comparison = nil
	omitted.ComparisonSet = false
	again, err := s.PutInterviewFeedback(ctx, omitted)
	if err != nil || !reflect.DeepEqual(again.Comparison, first.Comparison) || !again.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatal("omission did not preserve unchanged payload", err)
	}
	retry, err := s.PutInterviewFeedback(ctx, f)
	if err != nil || !retry.UpdatedAt.Equal(first.UpdatedAt) || !retry.SubmittedAt.Equal(first.SubmittedAt) {
		t.Fatal("retry timestamps", err)
	}
	// A writer from the old binary does not mention the additive column.
	answers, _ := json.Marshal(f.Answers)
	_, err = s.Pool.Exec(ctx, `INSERT INTO interview_feedback(session_id,user_id,version,answers,comment,share_transcript) VALUES($1,$2,$3,$4,'old client edit',false) ON CONFLICT(session_id) DO UPDATE SET answers=EXCLUDED.answers,comment=EXCLUDED.comment,share_transcript=EXCLUDED.share_transcript`, id, u.ID, InterviewFeedbackVersion, answers)
	if err != nil {
		t.Fatal(err)
	}
	preserved, err := s.GetInterviewFeedback(ctx, u.ID, id)
	if err != nil || !reflect.DeepEqual(preserved.Comparison, first.Comparison) {
		t.Fatal("older binary clobbered comparison", err)
	}
	// Presence-aware update is atomic: any ordering of omitted and explicit writes
	// keeps the explicit comparison; no read-then-write default can erase it.
	edited := f
	edited.Comparison = testToolComparison()
	edited.Comparison.Details = "Updated synthetic detail"
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			v := omitted
			if i == 0 {
				v = edited
			}
			if _, e := s.PutInterviewFeedback(ctx, v); e != nil {
				t.Error(e)
			}
		}(i)
	}
	wg.Wait()
	saved, err := s.GetInterviewFeedback(ctx, u.ID, id)
	if err != nil || saved.Comparison.Details != edited.Comparison.Details || !saved.SubmittedAt.Equal(first.SubmittedAt) {
		t.Fatal("concurrent preserve", err)
	}
	raw, err := s.ExportAccount(ctx, u.ID)
	if err != nil || !strings.Contains(string(raw), "Updated synthetic detail") || strings.Contains(string(raw), "PRIVATE_REFERENCE") {
		t.Fatal("owner export", err)
	}
	raw, err = s.ExportAccount(ctx, other.ID)
	if err != nil || strings.Contains(string(raw), "Updated synthetic detail") {
		t.Fatal("foreign export", err)
	}
	window, err := s.InterviewFeedbackWindow(ctx, time.Now().Add(-time.Hour), time.Now())
	if err != nil || len(window) != 1 {
		t.Fatal("window", err)
	}
	c := window[0].Response.Comparison
	if c == nil || c.PriorUse != "yes" || c.Preference != "other_tools_better" || c.Version != ToolComparisonVersion || c.ToolNames != "" || c.Details != "" {
		t.Fatal("metrics query read free text or lost categories")
	}
	cleared := omitted
	cleared.ComparisonSet = true
	clear, err := s.PutInterviewFeedback(ctx, cleared)
	if err != nil || clear.Comparison != nil || !clear.SubmittedAt.Equal(first.SubmittedAt) || !clear.UpdatedAt.After(saved.UpdatedAt) {
		t.Fatal("explicit null did not clear", err)
	}
	clearRetry, err := s.PutInterviewFeedback(ctx, cleared)
	if err != nil || !clearRetry.UpdatedAt.Equal(clear.UpdatedAt) {
		t.Fatal("null retry changed timestamp", err)
	}
	if _, err = s.PutInterviewFeedback(ctx, f); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM interview_feedback WHERE session_id=$1`, id).Scan(&n); err != nil || n != 0 {
		t.Fatal("session cascade", err)
	}
	id = comparisonSession(t, s, u.ID)
	f.SessionID = id
	if _, err = s.PutInterviewFeedback(ctx, f); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM interview_feedback WHERE session_id=$1`, id).Scan(&n); err != nil || n != 0 {
		t.Fatal("account cascade", err)
	}
}
func TestPostgresComparisonOnlySuggestionsPaginationAndConstraints(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, "comparison-comments@example.test", "unused")
	ids := []string{}
	for i := 0; i < 4; i++ {
		id := comparisonSession(t, s, u.ID)
		ids = append(ids, id)
		f := InterviewFeedback{SessionID: id, UserID: u.ID, Version: InterviewFeedbackVersion, Answers: surveyAnswers(), ComparisonSet: true}
		if i < 3 {
			f.Comparison = testToolComparison()
		}
		if _, err := s.PutInterviewFeedback(ctx, f); err != nil {
			t.Fatal(err)
		}
	}
	at := time.Now().UTC().Add(-time.Hour)
	if _, err := s.Pool.Exec(ctx, `UPDATE interview_feedback SET updated_at=$1`, at); err != nil {
		t.Fatal(err)
	}
	first, more, err := s.InterviewFeedbackComments(ctx, 2, nil)
	if err != nil || !more || len(first) != 2 {
		t.Fatal("first page", err)
	}
	last := first[1]
	second, more, err := s.InterviewFeedbackComments(ctx, 2, &FeedbackCursor{UpdatedAt: last.Response.UpdatedAt, SessionID: last.Session.ID})
	if err != nil || more || len(second) != 1 {
		t.Fatal("second page", err)
	}
	seen := map[string]bool{}
	for _, r := range append(first, second...) {
		if seen[r.Session.ID] || r.Response.Comparison == nil || r.Response.Comment != "" || r.Response.UserID != "" || strings.Contains(string(r.Session.QuestionSnapshot), "PRIVATE_REFERENCE") {
			t.Fatal("comparison-only suggestions privacy/paging")
		}
		seen[r.Session.ID] = true
	}
	for _, raw := range []string{`[]`, `{}`, `{"version":"wrong"}`, `{"version":"tool-comparison-v1","prior_use":"no","tool_names":"hidden","preference":"","details":""}`, `{"version":"tool-comparison-v1","prior_use":"yes","tool_names":null,"preference":"","details":""}`, `{"version":"tool-comparison-v1","prior_use":"yes","tool_names":"","preference":"bogus","details":""}`} {
		if _, err = s.Pool.Exec(ctx, `UPDATE interview_feedback SET comparison=$2::jsonb WHERE session_id=$1`, ids[0], raw); err == nil {
			t.Fatalf("DB accepted invalid comparison %s", raw)
		}
	}
	large := testToolComparison()
	large.ToolNames = strings.Repeat("語", 301)
	raw, _ := json.Marshal(large)
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_feedback SET comparison=$2::jsonb WHERE session_id=$1`, ids[0], raw); err == nil {
		t.Fatal("DB accepted oversized names")
	}
	large.ToolNames = strings.Repeat("語", 300)
	large.Details = strings.Repeat("語", 1000)
	raw, _ = json.Marshal(large)
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_feedback SET comparison=$2::jsonb WHERE session_id=$1`, ids[0], raw); err != nil {
		t.Fatal("DB rejected valid Unicode limits", err)
	}
}
func TestValidateToolComparison(t *testing.T) {
	if ValidateToolComparison(nil) != nil {
		t.Fatal("optional nil")
	}
	for _, prior := range []string{"yes", "no", "prefer_not_to_say"} {
		if ValidateToolComparison(&ToolComparison{Version: ToolComparisonVersion, PriorUse: prior}) != nil {
			t.Fatal("minimal object", prior)
		}
	}
	for _, change := range []func(*ToolComparison){func(c *ToolComparison) { c.Version = "stale" }, func(c *ToolComparison) { c.PriorUse = "" }, func(c *ToolComparison) { c.Preference = "invalid" }, func(c *ToolComparison) { c.PriorUse = "no" }, func(c *ToolComparison) { c.ToolNames = strings.Repeat("語", 301) }, func(c *ToolComparison) { c.Details = strings.Repeat("語", 1001) }, func(c *ToolComparison) { c.ToolNames = string([]byte{255}) }, func(c *ToolComparison) { c.Details = string([]byte{255}) }} {
		c := testToolComparison()
		change(c)
		if ValidateToolComparison(c) == nil {
			t.Fatal("invalid comparison accepted")
		}
	}
}
