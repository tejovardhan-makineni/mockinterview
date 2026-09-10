package memstore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func comparisonSurveyFixture(t *testing.T, m *Mem, email string) store.InterviewFeedback {
	t.Helper()
	ctx := context.Background()
	u, err := m.CreateUser(ctx, email, "unused")
	if err != nil {
		t.Fatal(err)
	}
	s, err := m.CreateSession(ctx, u.ID, "question", "conversational", "engineering", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now().UTC().Add(-time.Hour)
	m.mu.Lock()
	m.sessions[s.ID].sess.Status = "complete"
	m.sessions[s.ID].sess.StartedAt = &started
	m.sessions[s.ID].sess.FeedbackVersion = store.InterviewFeedbackVersion
	m.mu.Unlock()
	answers := make(map[string]string, len(store.InterviewFeedbackQuestionIDs))
	for _, id := range store.InterviewFeedbackQuestionIDs {
		answers[id] = "4"
	}
	return store.InterviewFeedback{SessionID: s.ID, UserID: u.ID, Version: store.InterviewFeedbackVersion, Answers: answers}
}

func comparisonSample() *store.ToolComparison {
	return &store.ToolComparison{Version: store.ToolComparisonVersion, PriorUse: "yes", ToolNames: "Another practice tool", Preference: "about_same", Details: "The follow-up questions felt comparable."}
}

func TestComparisonPresenceAndIdempotentTimestamps(t *testing.T) {
	m := New()
	ctx := context.Background()
	base := comparisonSurveyFixture(t, m, "comparison@example.test")
	first := base
	first.Comparison = &store.ToolComparison{Version: "ignored without presence"}
	if got, err := m.PutInterviewFeedback(ctx, first); err != nil || got.Comparison != nil {
		t.Fatalf("omitted comparison on first write = %+v, err=%v", got.Comparison, err)
	}
	wanted := *comparisonSample()
	replacement := wanted
	replacement.Preference = "mockinterview_better"
	tests := []struct {
		name       string
		set        bool
		comparison *store.ToolComparison
		want       *store.ToolComparison
		changed    bool
	}{
		{"add", true, &wanted, &wanted, true},
		{"omit preserves", false, nil, &wanted, false},
		{"omitted pointer ignored", false, &store.ToolComparison{Version: "invalid"}, &wanted, false},
		{"identical object", true, &wanted, &wanted, false},
		{"replace", true, &replacement, &replacement, true},
		{"clear", true, nil, nil, true},
		{"repeat clear", true, nil, nil, false},
		{"omit after clear", false, nil, nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// A fixed previous timestamp distinguishes changes without timing sleeps.
			previous := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			submitted := previous.Add(-time.Hour)
			m.mu.Lock()
			old := m.interviewFeedback[base.SessionID]
			old.SubmittedAt, old.UpdatedAt = submitted, previous
			m.interviewFeedback[base.SessionID] = old
			m.mu.Unlock()
			input := base
			input.ComparisonSet, input.Comparison = tc.set, tc.comparison
			got, err := m.PutInterviewFeedback(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Comparison, tc.want) {
				t.Fatalf("comparison = %+v, want %+v", got.Comparison, tc.want)
			}
			if got.ComparisonSet || !got.SubmittedAt.Equal(submitted) {
				t.Fatal("write presence leaked or original submission time changed")
			}
			if tc.changed && !got.UpdatedAt.After(previous) || !tc.changed && !got.UpdatedAt.Equal(previous) {
				t.Fatalf("updated_at = %v, changed = %v", got.UpdatedAt, tc.changed)
			}
			m.mu.Lock()
			storedFlag := m.interviewFeedback[base.SessionID].ComparisonSet
			m.mu.Unlock()
			if storedFlag {
				t.Fatal("write-only presence flag was stored")
			}
		})
	}
}

func TestComparisonCopiesAndMetricsMinimization(t *testing.T) {
	m := New()
	ctx := context.Background()
	input := comparisonSurveyFixture(t, m, "copies@example.test")
	input.ComparisonSet, input.Comparison = true, comparisonSample()
	want := *input.Comparison
	put, err := m.PutInterviewFeedback(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Comparison.ToolNames = "mutated input"
	put.Comparison.Details = "mutated write result"
	read := func() *store.InterviewFeedback {
		t.Helper()
		got, err := m.GetInterviewFeedback(ctx, input.UserID, input.SessionID)
		if err != nil || got == nil || !reflect.DeepEqual(got.Comparison, &want) || got.ComparisonSet {
			t.Fatalf("stored comparison changed or presence leaked: %+v, err=%v", got, err)
		}
		return got
	}
	read().Comparison.Preference = "other_tools_better"
	read()
	rows, more, err := m.InterviewFeedbackComments(ctx, 25, nil)
	if err != nil || more || len(rows) != 1 || !reflect.DeepEqual(rows[0].Response.Comparison, &want) {
		t.Fatalf("comparison-only comments = %+v, more=%v, err=%v", rows, more, err)
	}
	rows[0].Response.Comparison.ToolNames = "mutated comments result"
	read()
	window, err := m.InterviewFeedbackWindow(ctx, time.Now().Add(-2*time.Hour), time.Now())
	if err != nil || len(window) != 1 || window[0].Response == nil || window[0].Response.Comparison == nil {
		t.Fatalf("metrics window = %+v, err=%v", window, err)
	}
	c := window[0].Response.Comparison
	if c.ToolNames != "" || c.Details != "" || c.Version != want.Version || c.PriorUse != want.PriorUse || c.Preference != want.Preference {
		t.Fatalf("metrics must retain categorical values and omit raw text: %+v", c)
	}
	c.Preference = "other_tools_better"
	read()
}

func TestComparisonOwnershipExportAndDeletion(t *testing.T) {
	m := New()
	ctx := context.Background()
	one := comparisonSurveyFixture(t, m, "one@example.test")
	two := comparisonSurveyFixture(t, m, "two@example.test")
	one.ComparisonSet, one.Comparison = true, comparisonSample()
	two.ComparisonSet, two.Comparison = true, comparisonSample()
	one.Comparison.Details = "First owner's private comparison"
	two.Comparison.Details = "Second owner's private comparison"
	for _, f := range []store.InterviewFeedback{one, two} {
		if _, err := m.PutInterviewFeedback(ctx, f); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m.GetInterviewFeedback(ctx, two.UserID, one.SessionID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-owner read: %v", err)
	}
	foreign := one
	foreign.UserID, foreign.Comparison = two.UserID, two.Comparison
	if _, err := m.PutInterviewFeedback(ctx, foreign); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-owner write: %v", err)
	}
	exported, err := m.ExportAccount(ctx, one.UserID)
	if err != nil {
		t.Fatal(err)
	}
	var account struct {
		Responses []store.InterviewFeedback `json:"interview_feedback"`
	}
	if err := json.Unmarshal(exported, &account); err != nil {
		t.Fatal(err)
	}
	if len(account.Responses) != 1 || !reflect.DeepEqual(account.Responses[0].Comparison, one.Comparison) {
		t.Fatalf("export omitted or mixed comparisons: %+v", account.Responses)
	}
	if strings.Contains(string(exported), two.Comparison.Details) || strings.Contains(string(exported), "ComparisonSet") || strings.Contains(string(exported), "comparison_set") {
		t.Fatal("export leaked another owner's response or internal presence flag")
	}
	if err := m.DeleteSession(ctx, one.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.GetInterviewFeedback(ctx, one.UserID, one.SessionID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted session response remained: %v", err)
	}
	exported, err = m.ExportAccount(ctx, one.UserID)
	if err != nil || strings.Contains(string(exported), one.Comparison.Details) {
		t.Fatalf("deleted response remained in export: %v", err)
	}
	if got, err := m.GetInterviewFeedback(ctx, two.UserID, two.SessionID); err != nil || got == nil || !reflect.DeepEqual(got.Comparison, two.Comparison) {
		t.Fatalf("other owner's response changed: %+v, err=%v", got, err)
	}
	if err := m.DeleteUser(ctx, two.UserID); err != nil {
		t.Fatal(err)
	}
	rows, _, err := m.InterviewFeedbackComments(ctx, 25, nil)
	if err != nil || len(rows) != 0 {
		t.Fatalf("deleted comparisons remained in admin comments: %+v, err=%v", rows, err)
	}
	m.mu.Lock()
	remaining := len(m.interviewFeedback)
	m.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("feedback did not cascade: %d responses", remaining)
	}
}

func TestComparisonOnlyCommentsIncludeOptOutAndRespectClearing(t *testing.T) {
	m := New()
	ctx := context.Background()
	base := comparisonSurveyFixture(t, m, "no-comparison@example.test")
	optOut := comparisonSurveyFixture(t, m, "opt-out@example.test")
	optOut.ComparisonSet = true
	optOut.Comparison = &store.ToolComparison{Version: store.ToolComparisonVersion, PriorUse: "prefer_not_to_say"}
	for _, f := range []store.InterviewFeedback{base, optOut} {
		if _, err := m.PutInterviewFeedback(ctx, f); err != nil {
			t.Fatal(err)
		}
		if pending, err := m.PendingInterviewFeedback(ctx, f.UserID); err != nil || len(pending) != 0 {
			t.Fatalf("optional comparison must not block completed survey: pending=%d, err=%v", len(pending), err)
		}
	}
	rows, more, err := m.InterviewFeedbackComments(ctx, 1, nil)
	if err != nil || more || len(rows) != 1 || rows[0].Session.ID != optOut.SessionID {
		t.Fatalf("comparison-only opt-out omitted or blank response included: %+v, more=%v, err=%v", rows, more, err)
	}
	optOut.Comparison = nil
	if _, err := m.PutInterviewFeedback(ctx, optOut); err != nil {
		t.Fatal(err)
	}
	rows, more, err = m.InterviewFeedbackComments(ctx, 1, nil)
	if err != nil || more || len(rows) != 0 {
		t.Fatalf("cleared comparison remained in comments: %+v, more=%v, err=%v", rows, more, err)
	}
}
